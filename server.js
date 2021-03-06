require('dotenv').config();
const crypto = require('crypto');
const axios = require('axios');
const express = require('express');
const bodyParser = require('body-parser');
const qs = require('qs');

// Load in the environment variables
const slackAccessToken = process.env.SLACK_ACCESS_TOKEN;
const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const websiteVerificationToken = process.env.WEBSITE_VERIFICATION_TOKEN;

// Initializes express app
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// Middleware to hopefully handle slack requests
app.use('/slack/slack-link/commands', function (req, res, next) {
    let slackSignature = req.headers['x-slack-signature'];
    let requestBody = qs.stringify(req.body, { format: 'RFC1738' });
    let timestamp = req.headers['x-slack-request-timestamp'];
    // convert current time from milliseconds to seconds
    const time = Math.floor(new Date().getTime() / 1000);
    // Most likely a replay attack
    if (Math.abs(time - timestamp) > 300) {
        return res.status(200).send('Ignore this request.');
    }
    let sigBasestring = 'v0:' + timestamp + ':' + requestBody;
    let mySignature = 'v0=' +
        crypto.createHmac('sha256', slackSigningSecret)
            .update(sigBasestring, 'utf8')
            .digest('hex');
    // Safe against timing attacks
    if (crypto.timingSafeEqual(Buffer.from(mySignature, 'utf8'), Buffer.from(slackSignature, 'utf8'))) {
        next();
    } else {
        return res.status(200).send('Request verification failed');
    }
});

app.post('/slack/slack-link/commands', slackSlashCommands);

// Initializes server on PORT 4000
app.listen(4000, function () {
    console.log("Started on PORT 4000");
})

async function slackSlashCommands(req, res) {
    let command = req.body.command;
    // Link user command
    if (command == "/linkuser") {
        await linkUser(req, res);
    } else if (command == "/checklink") {
        // I felt the code was getting a little cluttered so I moved the command into a function
        await checkUserLink(req, res);
    } else if (command == "/memberinfo") {
        await memberInfo(req, res);
    } else {
        // This gets hit if slack sends a post to this app but we didn't program for that command
        console.log("Command not configured!");
        res.send("It appears the command you are trying to send isn't support");
    }
}

async function checkUserLink(req, res) {
    let req_body = req.body;
    // The paramaters after the command
    let text = req_body.text;
    // Puts it in the format that database has
    let user = "<@" + req_body.user_id + ">";
    let rpia_query_url = `https://rpiambulance.com/slack-link.php?token=${websiteVerificationToken}&slack_id=`;
    // If they gave us no paramaters just return themselves
    if (text.length == 0) {
        // Encodes the userID of who initialized the command to be sent
        rpia_query_url += encodeURIComponent(user);
    } else {
        text = text.split(" ");
        user = text[0];
        // Means it's most likely not a user
        if (user.indexOf("<") != 0) {
            res.send("The first paramter must be a user!");
            return;
        }
        // We chop off the username as slack is deprecating this
        user = user.substring(0, user.indexOf("|"));
        user += ">";
        rpia_query_url += encodeURI(user);
    }
    // Here's where we make the actual request to RPIA servers
    try {
        const response = await axios.get(rpia_query_url);
        if (response.status === 200) {
            return res.send(response.data);
        }
    } catch (err) {
        console.error(err);
        return res.send("Oops! Something went wrong with the server request to RPIA!");
    }
}

async function linkUser(req, res) {
    const req_body = req.body;
    if (!(await isAdmin(req_body.user_id))) {
        return res.send("This command can only be used by an admin!");
    } else {
        let text = req_body.text
        text = text.split(" ");
        let user = text[0];
        // Means it's most likely not a user
        if (user.indexOf("<") != 0) {
            res.send("The first paramter must be a user!");
            return;
        }

        user = user.substring(0, user.indexOf("|"));
        user += ">";
        let web_id = text[1];
        if (isNaN(web_id)) {
            res.send("The second paramater must be a whole number!");
            return;
        }

        // Sends the post request to rpiambulance.com 
        try {
            const response = await axios.post('https://rpiambulance.com/slack-link.php', qs.stringify({
                slack_id: user,
                member_id: web_id,
                token: websiteVerificationToken
            }));
            if (response.status == 200) {
                return res.send(response.data);
            }
        } catch (err) {
            console.error(err);
            return res.send("Oops! Something happened with that server request, please try again later.");
        }
    }
}

async function memberInfo(req, res) {
    const req_body = req.body;
    // The paramaters after the command
    let text = req_body.text;
    // Puts it in the format that database has
    let user = "<@" + req_body.user_id + ">";
    let rpia_query_url = `https://rpiambulance.com/slack-link.php?token=${websiteVerificationToken}&type=info&slack_id=`;
    // If they gave us no paramaters just return themselves
    if (text.length == 0) {
        // Encodes the userID of who initialized the command to be sent
        rpia_query_url += encodeURIComponent(user);
    } else {
        text = text.split(" ");
        user = text[0];
        // Means it's most likely not a user
        if (user.indexOf("<") != 0) {
            res.send("The first paramter must be a user!");
            return;
        }
        // We chop off the username as slack is deprecating this
        user = user.substring(0, user.indexOf("|"));
        user += ">";
        rpia_query_url += encodeURI(user);
    }
    // Add the fact that the user is an admin so they can get more information
    if (await isAdmin(req_body.user_id)) {
        rpia_query_url += "&admin=1";
    }
    // Here's where we make the actual request to RPIA servers
    try {
        const response = await axios.get(rpia_query_url);
        if (response.status == 200) {
            return res.send(response.data);
        }
    } catch (err) {
        console.log(rpia_query_url);
        console.error(err);
        return res.send("Oops! Something went wrong with the server request to RPIA!");
    }
}

async function isAdmin(userId) {
    const slack_userinfo_url = "https://slack.com/api/users.info?token=" + slackAccessToken + "&user=" + userId;
    try {
        const response = await axios.get(slack_userinfo_url);
        if (response.status === 200) {
            return response.data.user.is_admin
        } else {
            return false;
        }
    } catch (err) {
        console.error(`Bad Admin Request: ${err}`);
        return false;
    }
}