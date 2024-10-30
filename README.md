LICENZA - [![License](https://img.shields.io/github/license/italia/bootstrap-italia.svg)](https://github.com/italia/bootstrap-italia/blob/master/LICENSE)

# DRemailer
DRemailer is a local mail server that can relay received emails at regular intervals.
Help you to send emails when servers like Exchange have "numer of mails per minute" limitation, for example, if you need to send a copy of transport document to your 3000 customers from your RDP automatic mail sender (that send all emails in one shot), some servers won't do it (Exchange does not let you to send more then 30 mails in une minute). To do it you need su subscribe some paying service like mailchimp or some others; DRemailer can be set to relay emails al specific intervals, if you set interval to 2 seconds, the problem are solved.

## Features
- Emails are releyed as is, so, without changing anything in from, to, subject, body, ecc.
- Setting interval to 0 becomes a instant relay.
- You can control remailer execution (start, stop, suspend) via express routes.

## How it works
- At start, scan storage folders and fill the queues.
- Email is received, stored on disk, pushed to sending queue and the "sent notification" is back to client (in this moment email is not really sent to destination).
- Each 2 seconds the first email in the sending queue will be trying to send. If sent, the email is moved to the backup folder and deleted from sending queue, in case of error is moved to error queue.

## Modules
DRemailer are composed of 3 modules:

### dremailer.ts
Main remailer module. Handles receiving, storing and re-sending emails.

### dmailsender.ts
Based on [nodemailer](https://nodemailer.com/) library, this module can create, send or forward emails easly.

#### example
``` ts
// Create config
    const senderConfig: DMailSenderConfig = {
        smtpHost: process.env.EMAIL_HOST,
        smtpPort: process.env.EMAIL_PORT,
        secure: envVal(process.env.EMAIL_SECURE),
        auth: {
            user: process.env.EMAIL_USERNAME,
            pass: process.env.EMAIL_PASSWORD,
        }
    };
    // Istantiate server
    const mailSender = new DMailSender(senderConfig);
    // Init server
    mailSender.init();
    if (!mailSender.status.ready) {
        const err=new Error("DMailSender init error: "+mailSender.status.message);
        res.status(400).send(log_err(err.message));
        return;
    }
    // Create message
    const message: Mail.Options = {
        from: req.body?.from,       // Sender address
        to: req.body?.to,           // List of to recipients
        cc: req.body?.cc,           // List of cc recipients
        bcc: req.body?.bcc,         // List of bcc recipients
        replyTo: req.body?.replyTo, // List of replyTo recipients
        subject: req.body?.subject, // Subject
        text: req.body?.text,       // Plain text body
        html: req.body?.html,       // Html body
    };
    // Send message
    mailSender.sendMail(message)
    .then((info) => {
        log_msg("Inviata");
        res.status(200).json(info);
    })
    .catch((err: Error) => {
        log_err(err.message);
        res.status(400).send(err.message);
    })
```

### routes.ts
[Express](https://www.npmjs.com/package/express) routes that provide APIs to control remailer remotely.