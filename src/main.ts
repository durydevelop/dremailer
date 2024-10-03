/**
 * Remailer: forward emails waiting interval from each other
 * - Create a local smtp server without autentication.
 * - You need to set your email client with server address, port and no autentication.
 * -
 */
import { DRemailer, DRemailerConfig } from "./dremailer";
import { DLogger, DLoggerConfig, DLogger as log } from "./dlogger";
import path from "path";
import { SMTPServerAddress } from "smtp-server";
import { startRemailerControlApi } from "./routes";

// Configuration constants
const LISTEN_PORT = 2524;
const LISTEN_ADDRESS = '0.0.0.0';
const SENDER_HOST="smtp.office365.com"
const SENDER_PORT= 587
const SENDER_USERNAME="noreply@photorec.it"
const SENDER_PASSWORD="TruccareNubifragio83?"
const SENDER_TLS=false

// Logger config for inbound traffic
const inBoundConfig: DLoggerConfig = {
    filename: path.join(__dirname,"inBound.txt"),
    showStartTag: true,
    showLevel: true,
    showTimeStamp: true,
    enableConsole: true,
    enableColors: true
};

// Logger config for utbound traffic
const outBoundConfig: DLoggerConfig = {
    filename: path.join(__dirname,"outBound.txt"),
    showStartTag: true,
    showLevel: true,
    showTimeStamp: true,
    enableConsole: true,
    enableColors: true
};

// Create loggers
const inBound=new DLogger(inBoundConfig).init();
inBound.startTag="Inbound";
const outBound=new DLogger(outBoundConfig).init();
outBound.startTag="Outbound";

// Create remailer configuration and callbacks
const config: DRemailerConfig = {
    listenerAddress: LISTEN_ADDRESS,                        // smtp listener address to bound to
    listenerPort: LISTEN_PORT,                              // smtp listener port to bound to
    listenerSecure: false,                                  // smtp listener secure mode
    //listenerLmtp: true,                                   // smtp listener in lmtp mode
    listenerGreeting: "DRemailerConfig ti da il benvenuto", // optional greeting message. This message is appended to the default ESMTP response
    senderSmtpHost: SENDER_HOST,                            // smtp forwarding server hostname
    senderSmtpPort: SENDER_PORT,                            // smtp forwarding server port
    senderSmtpSecure: SENDER_TLS,                           // smtp forwarding server secure mode
    //senderIgnoreInvalidCert: true,                        // smtp does not care invalid certificates
    senderAuth: { user: SENDER_USERNAME, pass: SENDER_PASSWORD },   // smtp forwarding server credentials to use for sending emails
    //senderLmtp: true,                                     // smtp forwarding server in lmtp mode
    //emlStorageFolder: "/etc/customstorage"                // Local root folder for emails storage
    //sslKey: "",                                           // filename of the ssl .key file
    //sslCert: ""                                           // filename of the sss .crt file
    logEnabled: true,                                       // Enable/disable log
    timerIntervalSec: 2,                                    // Interval between each forwarding
    backupEnabled: true,                                    // If true, sent emails are copied to backup folder
    
    onReceiving: (session) => {
        inBound.info("Incoming : "+session.id+" : "+extractAdresses(session.envelope.rcptTo));
    },
    onSaving: (session) => {
        inBound.info("Saving   : "+session.id+" : "+extractAdresses(session.envelope.rcptTo));
    },
    onSaved: (session) => {
        inBound.info("Saved    : "+session.id+" : "+extractAdresses(session.envelope.rcptTo));
    },
    onReject: (session) => {
        inBound.error("Rejected : "+session.id+" : ",extractAdresses(session.envelope.rcptTo));
    },
    onForwarding: (emlFile) => {
        outBound.info("Sending : "+emlFile);
    },
    onForwarded: (emlFile) => {
        outBound.info("Sent    : "+emlFile);
    },
    onError: (err) => {
        log.e(err.message);
    },
    onWarning: (warning) => {
        log.w(warning.message);
    }
}

// Create remailer
let remailer=DRemailer.New(config);
// Run it
remailer.start();
// Print summary
remailer.showSummary();

// Start REST server for control APIs
startRemailerControlApi(remailer,16000,"dury");

/**
 * Extract all addresses from an array of SMTPServerAddress to a space separated string.
 * @param rcptTo a SMTPServerAddress array.
 * @returns Space separated list of addresses.
 */
function extractAdresses(rcptTo: SMTPServerAddress[]) {
    return rcptTo.map((address) => address.address).join(" ");
}
