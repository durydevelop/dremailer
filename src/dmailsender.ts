import nodemailer , { Transporter } from "nodemailer";
import SMTPConnection from "nodemailer/lib/smtp-connection";
import Mail from "nodemailer/lib/mailer";
import fs from "fs";
import { AddressObject, simpleParser } from "mailparser"
import { DLogger as log } from "./dlogger";

/**
 * Configuration for DMailSender
    smtpHost:           SMTP server address.
    smtpPort:           SMTP server port.
    secure:             if true, the connection will use TLS. The default is false. If the server doesn’t start in TLS mode, it is still possible to upgrade clear text socket to TLS socket with the STARTTLS command (unless you disable support for it). If secure is true, additional tls options for tls.createServer can be added directly onto this options object.
    lmtp:               if true, use LMTP protocol insdeat of SMTP.
    log:                if true, enable traffic log.
    ignoreInvalidCert:  if true, accept all certificates.
    auth:               an SMTPConnection.AuthenticationType object.

    TODO:
    dsn – optional object to define DSN options

    id – is the envelope identifier that would be included in the response (ENVID)
    return – is either ‘headers’ or ‘full’. It specifies if only headers or the entire body of the message should be included in the response (RET)
    notify – is either a string or an array of strings that define the conditions under which a DSN response should be sent. Possible values are ‘never’, ‘success’, ‘failure’ and ‘delay’. The condition ‘never’ can only appear on its own, other values can be grouped together into an array (NOTIFY)
    recipient – is the email address the DSN should be sent (ORCPT)

    {
        id: 'some random message specific id',
        return: 'headers',
        notify: 'success',
        recipient: 'sender@example.com'
    }
 */
export interface DMailSenderConfig {
    smtpHost?: string,
    smtpPort?: number,
    secure?: boolean,
    lmtp?: boolean,
    log?: boolean,
    ignoreInvalidCert?: boolean,
    auth?: SMTPConnection.AuthenticationType;
    dsn?: SMTPConnection.DSNOptions;
}

// Sender status
interface DStatus { ready: boolean, message: string };


/**
 * DMailSender class
 */
export class DMailSender {
    private transporter: Transporter | undefined;
    private config: DMailSenderConfig = {};
    // initial status
    public status: DStatus = { ready: false, message: "Need to call init() before use this class" };

    /**
     * DMailSender class constructor.
     * @param config DMailSenderConfig configuration object, if not provided, default is used.
     * 
     */
    constructor(config?: DMailSenderConfig) {
        if (config) {
            this.config = config;
        }
        else {
            log.d("Using default config");
        }
    }

    /**
     * Convenient static method to create a new instance of DMailSender.
     * @param config config DMailSenderConfig configuration object, if not provided, default is used.
     * @returns new instance of DMailSender.
     */
    static New(config: DMailSenderConfig) : DMailSender {
        return new DMailSender(config).init();
    }

    /**
     * Initilize all stuff.
     * Must be called befor using class.
     * On succesfully init this.status.ready is true.
     * @returns this.
     */
    init() : DMailSender {
        log.d("DMailSender.init()");
        if (!this.config.smtpHost) {
            this.status={ ready: false, message: "no <smtpHost> set in config" };
            return this;
        }
        this.transporter = nodemailer.createTransport({
            host: this.config.smtpHost,
            port: this.config.smtpPort,
            secure: this.config.secure,
            lmtp: this.config.lmtp,
            tls: {
                rejectUnauthorized: !this.config.ignoreInvalidCert,
            },
            auth: this.config.auth,
            dsn: this.config.dsn,
          });
          this.status = { ready: true, message: "Init SUCCESS"};
          return this;
    }

    isReady() : boolean {
        return this.status.ready;
    }

    async sendMail(message: Mail.Options) {
        if (!this.status.ready) {
            return Promise.reject(new Error(log.e(this.status.message)))
        }
        return this.transporter?.sendMail(message);
    }

    /**
     * Forward an eml file content as a real email (not forwarded).
     * A new email is composed from eml file content informations (from, to, subject, etc...).
     * Async version
     * @param emailFilename 
     * @returns a Promise conatining info object received from server.
     */
    async forwardEml(emailFilename: fs.PathLike) : Promise<any> {
        if (!this.status.ready) {
            return Promise.reject(new Error(log.e(this.status.message)))
        }
        if (!fs.existsSync(emailFilename)) {
            return Promise.reject(new Error(log.e(emailFilename+" does not exist")));
        }
        if (fs.statSync(emailFilename).isDirectory()) {
            return Promise.reject(new Error(log.e(emailFilename+" is not a file")));
        }

        if (!this.transporter) {
            return Promise.reject(new Error(log.e("this.transporter is not ready")))
        }
        const transporter=this.transporter;
        return new Promise<any>((resolve, reject) => {
            fs.promises.readFile(emailFilename)
            .catch((err) => {
                reject(err);
            })
            .then((emailData) => {
                if (!emailData) {
                    return reject(new Error(log.e(emailFilename+" is empty")));
                }
                //log.d("emailData=",emailData.toString());
                simpleParser(emailData)
                .catch((err) => {
                    reject(err);
                })
                .then((parsedEmail) => {
                    log.d("parsedEmail=",parsedEmail);
                    if (!parsedEmail) {
                        return reject(new Error(log.e("simpleParser result empty")));
                    }
            
                    // Estrai le informazioni dall'email parsata
                    if (!parsedEmail.from) {
                        return reject(new Error(log.e("eml not contains <from> address")));
                    }
                    const to=this.convertAddress(parsedEmail.to);
                    if (!to) {
                        return reject(new Error(log.e("eml not contains <to> address")));
                    }
            
                    log.d("from=",parsedEmail.from);
                    log.d("to=",parsedEmail.to);
                    log.d("subject=",parsedEmail.subject);
                    log.d("text=",parsedEmail.text ? "PRESENT" : "NO TEXT");
                    log.d("html=",parsedEmail.html ? "PRESENT" : "NO HTML");
                    log.d("attachments="+parsedEmail.attachments.length);
            
                    // Configura l'oggetto opzioni per l'email da inviare
                    const mailOptions: Mail.Options = {
                        from: parsedEmail.from.text,
                        to: to,
                        subject: parsedEmail.subject,
                        text: parsedEmail.text,
                        html: parsedEmail.html ? parsedEmail.html : undefined,
                        attachments: parsedEmail.attachments as any[],
                    };

                    transporter.sendMail(mailOptions)
                    .catch((err) => {
                        reject(err);
                    })
                    .then((info) => {
                        resolve(info);
                    })
                });
            });
        });

        /*
        let emailData: Buffer;
        try {
            emailData = fs.readFileSync(emailFilename);
        }catch(err) {
            return Promise.reject(new Error(log.e("Cannot read "+emailFilename+" "+err)))
        }

        if (emailData.length == 0) {
            return Promise.reject(new Error(log.e(emailFilename+" is empty")));
        }

        //log.d("emailData=",emailData.toString());
        // Parse dell'email utilizzando simpleParser
        const parsedEmail = await simpleParser(emailData);
        log.d("parsedEmail=",parsedEmail);

        // Estrai le informazioni dall'email parsata
        if (!parsedEmail.from) {
            return Promise.reject(new Error(log.e("eml not contains <from> address")));
        }
        const to=this.convertAddress(parsedEmail.to);
        if (!to) {
            return Promise.reject(new Error(log.e("eml not contains <to> address")));
        }

        log.d("from=",parsedEmail.from);
        log.d("to=",parsedEmail.to);
        log.d("subject=",parsedEmail.subject);
        log.d("text=",parsedEmail.text ? "PRESENT" : "NO TEXT");
        log.d("html=",parsedEmail.html ? "PRESENT" : "NO HTML");
        log.d("attachments="+parsedEmail.attachments.length);

        // Configura l'oggetto opzioni per l'email da inviare
        const mailOptions: Mail.Options = {
            from: parsedEmail.from.text,
            to: to,
            subject: parsedEmail.subject,
            text: parsedEmail.text,
            html: parsedEmail.html ? parsedEmail.html : undefined,
            attachments: parsedEmail.attachments as any[],
        };
        
        return this.transporter.sendMail(mailOptions)
        */
    }

    /**
     * Convert a mailparser.AddressObject[] to a simple string address array.
     * @param addressObject a mailparser.AddressObject or array of it.
     * @returns an array of string with formatted email addresses.
     */
    private convertAddress(addressObject: AddressObject | AddressObject[] | undefined): string | Array<string> | undefined {
        if (!addressObject) {
            return undefined;
        }
    
        if (Array.isArray(addressObject)) {
            // Se from è un array di AddressObject
            return addressObject.map((item) => {
                // converte ciascun elemento dell'array in formato desiderato
                return item.text
            });
        }
    
        // Se from è un singolo AddressObject
        return addressObject.text;
    }

    close() {
        if (this.transporter) {
            this.transporter.close();
        }
        this.transporter=undefined;
    }

    async isServerReady() : Promise<boolean> {
        // verify connection configuration
        if (this.transporter) {
            let res=this.transporter.verify().catch((err) => {
                log.e("DSender verify error: ",err.message);
                return false;
            });
            return res;
        }
        else {
            log.e("You need to call init() before use this class");
            return false;
        }
    }
}
