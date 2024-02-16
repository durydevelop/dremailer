import { DRemailer, DRemailerConfig } from "./dremailer";
import { DLogger, DLoggerConfig, DLogger as log } from "./dlogger";
import path from "path";
import { SMTPServerAddress } from "smtp-server";

const LISTEN_PORT = 2524;
const LISTEN_ADDRESS = '0.0.0.0';

const SENDER_HOST="smtp.office365.com"
const SENDER_PORT= 587
const SENDER_USERNAME="noreply@photorec.it"
const SENDER_PASSWORD="TruccareNubifragio83?"
const SENDER_TLS=false

const inBoundConfig: DLoggerConfig = {
    filename: path.join(__dirname,"inBound.txt"),
    showStartTag: true,
    showLevel: true,
    showTimeStamp: true,
    enableConsole: true,
    enableColors: true
};

const outBoundConfig: DLoggerConfig = {
    filename: path.join(__dirname,"outBound.txt"),
    showStartTag: true,
    showLevel: true,
    showTimeStamp: true,
    enableConsole: true,
    enableColors: true
};

const inBound=new DLogger(inBoundConfig).init();
inBound.startTag="Inbound";
const outBound=new DLogger(outBoundConfig).init();
outBound.startTag="Outbound";

const config: DRemailerConfig = {
    listenerAddress: LISTEN_ADDRESS,
    listenerPort: LISTEN_PORT,
    //listenerLmtp: true,
    listenerSecure: false,
    listenerGreeting: "DRemailerConfig ti da il benvenuto",
    senderSmtpHost: SENDER_HOST,
    senderSmtpPort: SENDER_PORT,
    senderSmtpSecure: SENDER_TLS,
    //senderLmtp: true,
    timerIntervalSec: 2,
    senderAuth: { user: SENDER_USERNAME, pass: SENDER_PASSWORD },
    //emlStorageFolder: "storage",
    logEnabled: true,
    //sslKey: "",
    //sslCert: ""
    onReceiving: (session) => {
        inBound.info("Incoming : "+session.id+" : "+extractAdresses(session.envelope.rcptTo));
    },
    onSaving: (session) => {
        inBound.info("Saving   : "+session.id+" : "+extractAdresses(session.envelope.rcptTo));
    },
    onSaved: (session) => {
        inBound.info("Saved    : "+session.id+" : "+extractAdresses(session.envelope.rcptTo));
    },
    onForwarding: (emlFile) => {
        outBound.info("Sending : "+emlFile);
    },
    onForwarded: (emlFile) => {
        outBound.info("Sent    : "+emlFile);
    },
    onReject: (session) => {
        inBound.error("Rejected : "+session.id+" : ",extractAdresses(session.envelope.rcptTo));
    },
    onError: (err) => {
        log.e(err.message);
    }
}

let remailer=DRemailer.New(config);
remailer.showSummary();
remailer.start();

function extractAdresses(rcptTo: SMTPServerAddress[]) {
    return rcptTo.map((address) => address.address).join(" ");
}


import express, { Request, Response, NextFunction } from "express"
const app=express();
startAdminAPI(16000,"dury");

function startAdminAPI(port: number, apiKey: string) {
    function checkApiKey(req: Request, res: Response, next: NextFunction) {
        const submittedAPIKey = req.query.api_key as string;
        //log.d("req.query",req.query);
        if (!submittedAPIKey || submittedAPIKey.trim() !== apiKey) {
            res.status(401)
            res.json({ message: 'Access denied' })
        }
        else {
            next()
        }
    }
  
    app.use(checkApiKey)

    app.post("/api/remailer/control", async (req,res) => {
        if (req.query.suspend_sender) {
            //log.d("req.query.suspend_sender",req.query.suspend_sender);
            remailer.suspendSender(req.query.suspend_sender == "true" ? true : false);
        }
        if (req.query.suspend_listener) {
            //log.d("req.query.suspend_sender",req.query.suspend_sender);
            remailer.suspendListener(req.query.suspend_listener == "true" ? true : false);
        }
        remailer.showSummary();
        return res.status(200).json("done");
    })

    app.listen(port, () => {
        log.d("app.listen()")
    });
}