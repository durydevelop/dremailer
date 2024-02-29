import { SMTPServer, SMTPServerAuthentication, SMTPServerAuthenticationResponse, SMTPServerDataStream, SMTPServerSession } from "smtp-server";
import { DMailSender } from "./dmailsender";
import fss from "fs";
import fsu from "fs/promises";
import path from "path";
import { DMailSenderConfig } from "./dmailsender";
import SMTPConnection from "nodemailer/lib/smtp-connection";
import { nullStream } from "./utils";
import { DLogger as log } from "./dlogger";

const DEFAULT_EML_STORAGE = path.join(__dirname,"storage");
const EML_PARKING = "eml-parking";                  // Where timed emails are stored
const EML_DIRECT = "eml-direct";                    // Where emails are stored for immediate fordwarding
const EML_ERROR = "eml-error";                      // Where emails are stored in case of sending error
const EML_PARKING_BACKUP = "eml-parking-backup";    // Where timed emails are backupped
const EML_DIRECT_BACKUP = "eml-direct-backup";      // Where immediate email are backupped

const MODE_DIRECT_FORWARD="DIRECT FORWARD";
const MODE_STORAGE="STORAGE ONLY";
const MODE_TIMED="TIMED FORWARD";

//! Status interface 
interface DStatus { ready: boolean, message: string };

//! Event callback
interface DEventCallback { (session : SMTPServerSession, err?: Error): void };
interface DForwardingCallback { (emlFile: string ): void };
interface DErrorCallback { (error: Error ): void };

/**
 * Configuration for DReamiler:
 * - if timerIntervalSec is greater than 0, emails in storage folder will be sent each one every senderTimerSec seconds (if mailStorageFolder is enabled).
 * - if timerIntervalSec is missing or <= 0, timer is disabled:
 * -- if senderSmtpHost is not set, each email is saved and forwarded immediatly (through emlDirectDir).
 * -- else emails are saved in emlParkingDir and you need to call forwwardOne() each time you want to forward an email.
 */
export interface DRemailerConfig {
    listenerAddress?: string;   // smtp listener address to bound to
    listenerPort?: number;      // smtp listener port to bound to
    listenerSecure?: boolean;   // smtp listener secure mode
    listenerLmtp?: boolean;     // smtp listener lmtp mode
    listenerGreeting?: string;  // optional greeting message. This message is appended to the default ESMTP response
    senderSmtpHost?: string;    // smtp forwarding server hostname
    senderSmtpPort?: number;    // smtp forwarding server port
    senderSmtpSecure?: boolean; // smtp forwarding server secure mode
    senderIgnoreInvalidCert?: boolean;
    senderAuth?: SMTPConnection.AuthenticationType;
    senderLmtp?: boolean;       // smtp forwarding server lmtp mode
    emlStorageFolder?: string;  // Local root folder for emails storage
    sslKey?: string;            // filename of a ssl .key file
    sslCert?: string;           // filename of a sss .crt file
    logEnabled?: boolean;       // Enable, disable log
    timerIntervalSec?: number;  // Interval between each forwarding
    backupEnabled: boolean;     // If true, sent email are backupped
    onReceiving?: DEventCallback;
    onSaving?: DEventCallback;
    onSaved?: DEventCallback;
    onReject?: DEventCallback;
    onForwarding?: DForwardingCallback;
    onForwarded?: DForwardingCallback;
    onError?: DErrorCallback;
}

/**
 * DRemailer class
 */
export class DRemailer {
    private smtpServer: SMTPServer | undefined = undefined;
    private static mailSender: DMailSender | undefined = undefined;

    private config: DRemailerConfig = { listenerAddress: "0.0.0.0", listenerPort: 25 };

    // Timer stuff
    timerHandle: any;
    timerIntervalMs: number = 0;

    // Storage stuff
    emlParkingQueue = new Array<string>();
    emlDirectQueue = new Array<string>();
    emlErrorQueue = new Array<string>();
    isEmlScanning: boolean = false;
    emlParkingDir: string | undefined = undefined;
    emlDirectDir: string | undefined = undefined;
    emlErrorDir: string | undefined = undefined;

    // Initial status
    public status: DStatus = { ready: false, message: "Need to call init() before use this class" };

    // Internal used
    private listenerRunning = false;    // true when smtp server is listening
    private senderPaused = false;       // true when sender is manualy paused
    private listenerPaused = false;     // true when sender is manualy paused

    /**
     * DRemailer class constructor.
     * @param config    ->  DRemailerConfig configuration.
     * 
     * If no config is provided, default configuration serves a local smtp server and
     * save all emails in emlParkingDir and does nothing else.
     * 
     * Listener:
     * - Bind on all IPs
     * - On standard port 25
     * - No secure
     * - No lmtp
     * - Storage enabled in DEFAULT_EML_STORAGE
     * 
     * Sender: DISABLED
     *
     * Timer:  DISABLED
     * 
     * Connection logs: DISABLED
     */
    constructor(config?: DRemailerConfig) {
        if (config) {
            this.config = config;
        }
        else {
            log.d("Using default config");
        }
    }

    /**
     * Convenient constructor to avoid calling init()
     */
    static New(config?: DRemailerConfig) : DRemailer {
        return(new DRemailer(config)).init();
    }

    /**
     * Init function need to be called before using class:
     * - Create smtp server
     * - Create sender
     * - Check for storage folder
     * 
     * @returns always an instance to this and set status.ready to true if all init succeds.
     * 
     * SMTPServer config:
        options.secure if true, the connection will use TLS. The default is false. If the server doesn’t start in TLS mode, it is still possible to upgrade clear text socket to TLS socket with the STARTTLS command (unless you disable support for it). If secure is true, additional tls options for tls.createServer can be added directly onto this options object.
        options.name optional hostname of the server, used for identifying to the client (defaults to os.hostname())
        options.banner optional greeting message. This message is appended to the default ESMTP response.
        options.size optional maximum allowed message size in bytes, see details here
        options.hideSize if set to true then does not expose the max allowed size to the client but keeps size related values like stream.sizeExceeded
        options.authMethods optional array of allowed authentication methods, defaults to [‘PLAIN’, ‘LOGIN’]. Only the methods listed in this array are allowed, so if you set it to [‘XOAUTH2’] then PLAIN and LOGIN are not available. Use [‘PLAIN’, ‘LOGIN’, ‘XOAUTH2’] to allow all three. Authentication is only allowed in secure mode (either the server is started with secure:true option or STARTTLS command is used)
        options.authOptional allow authentication, but do not require it
        options.disabledCommands optional array of disabled commands (see all supported commands here). For example if you want to disable authentication, use [‘AUTH’] as this value. If you want to allow authentication in clear text, set it to [‘STARTTLS’].
        options.hideSTARTTLS optional boolean, if set to true then allow using STARTTLS but do not advertise or require it. It only makes sense when creating integration test servers for testing the scenario where you want to try STARTTLS even when it is not advertised
        options.hidePIPELINING optional boolean, if set to true then does not show PIPELINING in feature list
        options.hide8BITMIME optional boolean, if set to true then does not show 8BITMIME in features list
        options.hideSMTPUTF8 optional boolean, if set to true then does not show SMTPUTF8 in features list
        options.allowInsecureAuth optional boolean, if set to true allows authentication even if connection is not secured first
        options.disableReverseLookup optional boolean, if set to true then does not try to reverse resolve client hostname
        options.sniOptions optional Map or an object of TLS options for SNI where servername is the key. Overrided by SNICallback.
        options.logger optional bunyan compatible logger instance. If set to true then logs to console. If value is not set or is false then nothing is logged
        options.maxClients sets the maximum number of concurrently connected clients, defaults to Infinity
        options.useProxy boolean, if set to true expects to be behind a proxy that emits a PROXY header (version 1 only)
        options.useXClient boolean, if set to true, enables usage of XCLIENT extension to override connection properties. See session.xClient (Map object) for the details provided by the client
        options.useXForward boolean, if set to true, enables usage of XFORWARD extension. See session.xForward (Map object) for the details provided by the client
        options.lmtp boolean, if set to true use LMTP protocol instead of SMTP
        options.socketTimeout how many milliseconds of inactivity to allow before disconnecting the client (defaults to 1 minute)
        options.closeTimeout how many millisceonds to wait before disconnecting pending connections once server.close() has been called (defaults to 30 seconds)
        options.onAuth is the callback to handle authentications (see details here)
        options.onConnect is the callback to handle the client connection. (see details here)
        options.onSecure is the optional callback to validate TLS information. (see details here)
        options.onMailFrom is the callback to validate MAIL FROM commands (see details here)
        options.onRcptTo is the callback to validate RCPT TO commands (see details here)
        options.onData is the callback to handle incoming messages (see details here)
        options.onClose is the callback that informs about closed client connection
     */
    init(): DRemailer {
        // Create smtp server instance
        log.d("Init listener");
        this.smtpServer = new SMTPServer({
            logger: this.config.logEnabled,
            lmtp: this.config.listenerLmtp,
            banner: this.config.listenerGreeting,
            secure: this.config.listenerSecure,
            // if secure is disable, also disable STARTTLS to allow authentication in clear text mode
            disabledCommands: !this.config.listenerSecure ? ['STARTTLS', 'AUTH'] : [],
            onData: (stream, session, callback) => this.onData(stream,session,callback),
            onClose: (session) => this.onClose(session),
            onAuth: (auth,session,callback) => this.onAuth(auth,session,callback),
        });
        this.smtpServer.on("error", this.onListenerError);

        if (this.config.senderSmtpHost) {
            log.d("Init sender");
            const senderConfig: DMailSenderConfig = {
                smtpHost: this.config.senderSmtpHost,
                smtpPort: this.config.senderSmtpPort,
                secure: this.config.senderSmtpSecure,
                lmtp: this.config.senderLmtp,
                log: this.config.logEnabled,
                ignoreInvalidCert: this.config.senderIgnoreInvalidCert,
                auth: this.config.senderAuth,
            };
            DRemailer.mailSender = new DMailSender(senderConfig);
            DRemailer.mailSender.init();
            if (DRemailer.mailSender.status.ready) {
                const err=new Error("Sender init error: "+DRemailer.mailSender.status.message);
                log.e(err.message);
                this.config.onError?.(err);
            }
        }

        log.d("Init storage");
        if (this.config.emlStorageFolder && this.config.emlStorageFolder.length > 0) {
            // Storage root
            if (!path.isAbsolute(this.config.emlStorageFolder)) {
                // Not absolute, make basename relative to this folder
                this.emlParkingDir=path.join(__dirname, path.basename(this.config.emlStorageFolder), EML_PARKING);
                this.emlDirectDir=path.join(__dirname, path.basename(this.config.emlStorageFolder), EML_DIRECT);
                this.emlErrorDir=path.join(__dirname, path.basename(this.config.emlStorageFolder), EML_ERROR);
            }
            else {
                this.emlParkingDir=path.join(this.config.emlStorageFolder, EML_PARKING);
                this.emlDirectDir=path.join(this.config.emlStorageFolder, EML_DIRECT);
                this.emlErrorDir=path.join(this.config.emlStorageFolder, EML_ERROR);
            }
        }
        else {
            this.emlParkingDir=path.join(DEFAULT_EML_STORAGE,EML_PARKING);
            this.emlDirectDir=path.join(DEFAULT_EML_STORAGE,EML_DIRECT);
            this.emlErrorDir=path.join(DEFAULT_EML_STORAGE, EML_ERROR);
        }

        // Check existing
        if (!fss.existsSync(this.emlParkingDir)) {
            // Does not exists
            log.d("Create missing folder "+this.emlParkingDir);
            try {
                fss.mkdirSync(this.emlParkingDir, { recursive: true });
            }catch(err) {
                const error=new Error("Cannot create parking storage folder: "+err);
                log.e(error.message);
                this.config.onError?.(error);
                this.emlParkingDir=undefined;
            }
        }

        if (!fss.existsSync(this.emlDirectDir)) {
            // Does not exists
            log.d("Create missing folder "+this.emlDirectDir);
            try {
                fss.mkdirSync(this.emlDirectDir, { recursive: true });
            }catch(err) {
                const error=new Error("Cannot create direct storage folder: "+err);
                log.e(error.message);
                this.config.onError?.(error);
                this.emlDirectDir=undefined;
            }
        }

        if (!fss.existsSync(this.emlErrorDir)) {
            // Does not exists
            log.d("Create missing folder "+this.emlErrorDir);
            try {
                fss.mkdirSync(this.emlErrorDir, { recursive: true });
            }catch(err) {
                const error=new Error("Cannot create error storage folder: "+err);
                log.e(error.message);
                this.config.onError?.(error);
                this.emlErrorDir=undefined;
            }
        }

        log.d("Init Timer");
        this.initSenderTimer();
        
        if (!this.isSenderReady() && !this.isStorageReady()) {
            const err=new Error("Init failed: sender and storage are not ready");
            this.status = { ready: false, message: log.e(err.message) };
            this.config.onError?.(err);
        }
        else {
            this.status = { ready: true, message: log.d("Init SUCCESS") };
        }
        return this;
    }

    isSenderReady() : boolean {
        if (!this.config.senderSmtpHost) {
            return false;
        }
        if (!DRemailer.mailSender) {
            return false;
        }
        return DRemailer.mailSender.status.ready;
    }

    isStorageReady(checkExisting?: boolean) : boolean {
        if (this.emlParkingDir && this.emlDirectDir && this.emlErrorDir) {
            if (checkExisting) {
                log.d("Check existing");
                let found=true;
                if (!fss.existsSync(this.emlParkingDir)) {
                    this.emlParkingDir=undefined;
                    found=false;
                }
                if (!fss.existsSync(this.emlDirectDir)) {
                    this.emlDirectDir=undefined;
                    found=false;
                }
                if (!fss.existsSync(this.emlErrorDir)) {
                    this.emlErrorDir=undefined;
                    found=false;
                }

                if (found) {
                    return true;
                }
            }
        }

        log.e("Storage not ready: Interval ms="+this.timerIntervalMs+" Parking folder="+this.emlParkingDir+ " Direct folder="+this.emlDirectDir+" Error folder="+this.emlErrorDir);
        return false;
    }

    /**
     * Start Remailer:
     * - Retrive eml storage content
     * - Start listener
     * 
     * @returns true on succefull this.smtpServer.listen() call.
     * N.B.
     * true does not mean that server is fully started.
     */
    start(): boolean {
        log.d("Starting...");
        if (this.listenerRunning) {
            log.w("Listener already running");
            if (this.listenerPaused) {
                this.listenerPaused=false;
                log.w("RESUMED from pause");
            }
            return true;
        }
        
        if (!this.status.ready) {
            const err=new Error("Cannot start, remailer not ready: "+this.status.message);
            log.e(err.message);
            this.config.onError?.(err);
            return false;
        }

        if (!this.smtpServer) {
            // may be redundant
            const err=new Error("Cannot start, remailer is not initilized. Call init() before start()");
            return false;
        }

        if (this.senderPaused) {
            this.senderPaused=false;
            log.w("Sender RESUMED from paused")
        }
        else {
            this.stopSenderTimer();
            if (this.emlParkingDir) {
                this.scanParkingSync();
            }

            this.smtpServer.listen(this.config.listenerPort,this.config.listenerAddress, (() => {
                this.status = { ready: true, message: log.d("Listener started") };
                if (this.timerIntervalMs > 0) {
                    this.startSenderTimer();
                }
                this.listenerRunning=true;
            }));
        }

        return true;
    }

    stop() {
        if (this.smtpServer && this.listenerRunning) {
            this.smtpServer.close()
        }
        if (DRemailer.mailSender?.isReady()) {
            DRemailer.mailSender?.close();
        }
    }

    /**
     * Scan eml files storage folder and fill this.emlQueue with filenames list (async version).
     * @returns true on fs read error, otherwise true.
     */
    private async scanStorage() {
        log.d("Scanning eml files...");
        if (!this.isStorageReady()) {
            // Storage not ready, clean all queues
            this.emlParkingQueue = [];
            this.emlDirectQueue = [];
            this.emlErrorQueue = [];
            const err=new Error("Parking storage folder not available");
            this.status = { ready: false, message: log.e(err.message) };
            this.config.onError?.(err);
            return Promise.reject(err);
        }

        if (this.isEmlScanning) {
            log.w("Already scanning...")
            return;
        }

        this.isEmlScanning = true;
        let parkingScanning=true;
        //return new Promise<void>(function (resolve,reject) {
            if (this.emlParkingDir) {
                fss.readdir(this.emlParkingDir, {withFileTypes: true}, (err, files) => {
                    parkingScanning = false;
                    if (err) {
                        this.emlParkingQueue=[];
                        const error=new Error("Parking storage scanning error: "+err.message);
                        this.config.onError?.(error);
                    }   
                    else {
                        this.emlParkingQueue=files.filter(item => !item.isDirectory() && item.name.split('.').pop() == "eml").map(item => item.name);
                    }
                })
            }

            this.status = { ready: true, message: log.d("eml files scanning end, files count: "+this.emlQueue.length) };
            this.status = { ready: false, message: log.e(err.message) };
        //});
    }

    /**
     * Scan eml files storage folder and fill this.emlQueue with filenames list (sync version).
     * @returns true on fs read error, otherwise true.
     */
    private scanStorageSync() : boolean {
        log.d("Scanning eml files...");
        if (!this.isStorageReady()) {
            // Storage not ready, clean all queues
            this.emlParkingQueue = [];
            this.emlDirectQueue = [];
            this.emlErrorQueue = [];
            const err=new Error("Parking storage folder not available");
            this.status = { ready: false, message: log.e(err.message) };
            this.config.onError?.(err);
            return Promise.reject(err);
        }

        if (this.isEmlScanning) {
            log.w("Already scanning...")
            return;
        }

        this.isEmlScanning = true;
        this.emlQueue=fss.readdirSync(this.emlParkingDir, {withFileTypes: true}).filter(item => !item.isDirectory() && item.name.split('.').pop() == "eml").map(item => item.name);
        this.status = { ready: true, message: log.d("eml files scanning end, files count: "+this.emlQueue.length) };
        this.isEmlScanning = false;
        return true;
    }

    private async saveEmailToDisk(stream: SMTPServerDataStream, session: SMTPServerSession, folder: string) : Promise<string> {
        this.config.onSaving?.(session);
        log.d("Try to save email id: "+session.id+" to "+folder);
        const currentDate = new Date().toISOString().replace(/[^\d]/g, "");
        const fileName = currentDate + "_" + session.id + ".eml";
        const filePath = path.join(folder, fileName);

        return await new Promise<string>((resolve, reject) => {
            stream.pipe(fss.createWriteStream(filePath)
                .on('finish', () => {
                    log.d("email id "+session.id+" saved to "+folder);
                    this.config.onSaved?.(session)
                    resolve(fileName);
                })
                .on('error', (error) => {
                    this.config.onError?.(error);
                    reject(new Error(log.e("Error saving email to disk:", error)));
                }));
        })
    }

    async forwardOne() : Promise<any> {
        if (!this.emlParkingDir) {
            this.emlQueue = [];
            const err=new Error("Parking storage folder not available");
            this.status = { ready: false, message: log.e(err.message) };
            this.config.onError?.(err);
            return false;
        }

        const emlFile = this.emlQueue.shift();
        if (emlFile) {
            const emlFilename=path.join(this.emlParkingDir,emlFile);
            log.d("Forwarding "+emlFile);
            return this.forward(emlFilename)
            .then(async (info) => {
                // delete file
                return await fsu.unlink(emlFilename)
                .catch((err: Error) => {
                    this.config.onError?.(err);
                    return err
                })
                .then(() => {
                    return info;
                })
            })
            .catch((err) => {
                //log.e("eml file " + emlFile + " not sent: ", err.message);
                // Re-push to the end of queue
                this.emlQueue.push(emlFile);
                return err;
            })
        }
    }

    async forward(emlFilename: string) : Promise<any> {
        this.config.onForwarding?.(emlFilename)
        return new Promise (async (resolve, reject) => {
            if (!DRemailer.mailSender) {
                return reject(new Error(log.e("Cannot forward, <mailSender> is not ready")));
            }
            DRemailer.mailSender.forwardEml(emlFilename)
            .then(async (info) => {
                log.d("Forwarded "+emlFilename);
                //log.d(" info",info);
                this.config.onForwarded?.(path.relative(path.join(path.dirname(emlFilename),".."),emlFilename));
                resolve(info);
            })
            .catch ((err) => {
                log.e("Not Forwarded ",err);
                this.moveToError(emlFilename,err);
                this.config.onError?.(err);
                reject(err);
            })
        });
    }

    getEmlQueueList() : string[] {
        return this.emlQueue;
    }

    moveToError(emlFilename: string, error: Error) {
        if (!this.emlErrorDir) {
            const err=new Error("Cannot move "+emlFilename+" to error folder: folder is unavailable");
            log.e(err.message);
            this.config.onError?.(err);
            return;
        }
        const emlFile=path.basename(emlFilename);
        fss.rename(emlFilename,path.join(this.emlErrorDir,emlFile), (err) => {
            if (err) {
                log.e("Cannot move "+emlFile+" to error folder: ",err.message);
                this.config.onError?.(err);
            }
        });
    }

    // ********************* Listener event handler **********************
    onAuth(auth: SMTPServerAuthentication, session: SMTPServerSession, callback: (err: Error | null | undefined, response?: SMTPServerAuthenticationResponse) => void) {
        log.d("auth=", auth);
        log.d("session=", session);
        // TODO: Handle credential
        /*
        if (auth.method !== "CRAM-MD5") {
            // should never occur in this case as only CRAM-MD5 is allowed
            return callback(new Error("Expecting CRAM-MD5"));
        }
        
        // CRAM-MD5 does not provide a password but a challenge response
        // that can be validated against the actual password of the user
        if (auth.username !== "abc" || !auth.validatePassword("def")) {
            return callback(new Error("Invalid username or password"));
        }
        */

        callback(null, {user: "accepted"}); // where 123 is the user id or similar property
    };
    
    private async onData(stream: SMTPServerDataStream, session: SMTPServerSession, callback: (err?: Error | null | undefined) => void): Promise<void> {
        this.config.onReceiving?.(session);
        if (!this.status.ready) {
            const err=new Error("Remailer not ready: "+this.status.message);
            stream.pipe(nullStream());
            callback(err);
            this.config.onReject?.(session, err);
        }
        else if (this.listenerPaused) {
            const err=new Error("Remailer paused, please try later");
            stream.pipe(nullStream());
            callback(err);
            this.config.onReject?.(session, err);
        }
        else {
            if (this.timerIntervalMs > 0) {
                // Store email in parking folder for delayed delivery
                if (!this.emlParkingDir) {
                    const err=new Error("Parking storage folder not available");
                    stream.pipe(nullStream());
                    callback(err);
                    this.config.onReject?.(session,err);
                }
                else {
                    this.saveEmailToDisk(stream, session, this.emlParkingDir)
                    .then((emlName) => {
                        // Queue for send
                        this.emlQueue.push(emlName);
                        callback();
                    })
                    .catch((err) => {
                        callback(err);
                        this.config.onReject?.(session,err);
                    })
                }
            }
            else {
                // Timer disabled, delivery now
                if (!this.emlDirectDir) {
                    const err=new Error("Direct storage folder not available");
                    stream.pipe(nullStream());
                    callback(err);
                    this.config.onReject?.(session,err);
                }
                else {
                    // Save to EML_DIRECT_FOLDER
                    const emlName=await this.saveEmailToDisk(stream, session, this.emlDirectDir).catch((err) => {
                        callback(err);
                        this.config.onReject?.(session,err);
                        return undefined;
                    });

                    if (emlName && !this.senderPaused) {
                        const emlFilename=path.join(this.emlDirectDir,emlName);
                        // Forward now
                        await this.forward(emlFilename)
                        .then(async (info) => {
                            //log.d("forward info=",info)
                            callback();
                            // delete file
                            await fsu.unlink(emlFilename)
                            .catch((err: Error) => {
                                const error=new Error("Cannot delete file: "+emlFilename+" "+err.message);
                                log.e(err.message)
                                this.config.onError?.(error);
                            })
                        })
                        .catch((err) => {
                            callback(err);
                            this.config.onReject?.(session,err);
                        });
                    }
                }
            }
        }
    }

    private onClose(session: SMTPServerSession): void {
        log.d("Session closed for ", session.clientHostname);
    }

    private onListenerError(error: any) {
        log.e("DRemailer onError() ", error);
        
        if (error.code == 'EADDRINUSE') {
            log.e('Address in use, retrying...');
            setTimeout(() => {
                if (this.smtpServer) {
                    this.smtpServer.close();
                    this.smtpServer.listen();
                }
            }, 1000);
        }
        
    }
    // *******************************************************************

    // ******************** Interval timer functions *********************

    /**
     * Set initial value for interval timer from config.
     */
    private initSenderTimer() {
        if (this.config.timerIntervalSec && this.config.timerIntervalSec > 0) {
            this.setSenderInterval(this.config.timerIntervalSec);
        }
        else {
            // Disabled
            this.setSenderInterval(0);
        }
    }
    /**
     * Set timer interval by each mail.
     * N.B If timer is enabled need to be restared.
     * @param seconds   ->  seconds between each mail send (value <= 0 disable the timer);
     * @returns false is sender is not ready, otherwise true.
     */
    setSenderInterval(seconds: number) : boolean {
        if (seconds > 0) {
            this.timerIntervalMs=seconds * 1000;
        }
        else {
            this.stopSenderTimer();
            this.timerIntervalMs=0;
        }

        return true;
    }

    startSenderTimer() {
        if (!this.isSenderReady() || this.senderPaused) {
            const err=new Error("Sender is disabled, remailer is in "+MODE_STORAGE+" MODE");
            log.w(err.message);
            this.config.onError?.(err);
            return;
        }
        if (this.timerIntervalMs <= 0) {
            const err=new Error("Timer is disabled, set a value before start");
            log.e(err.message);
            this.config.onError?.(err);
            return;
        }

        log.d("Starting timer");
        this.timerHandle = setInterval(() => {
            //log.d("tick");
            if (!this.senderPaused) {
                if (this.isEmlScanning) {
                    log.e("Storage scanning in progress... do nothing");
                    return;
                }
                this.forwardOne();
            }
        }, this.timerIntervalMs);
    }
    stopSenderTimer() {
        if (this.timerHandle) {
            clearInterval(this.timerHandle);
            log.d("Timer stopped");
        }
    }
    // *******************************************************************

    suspendSender(suspended: boolean) {
        if (this.senderPaused != suspended) {
            if (suspended) {
                log.w("Sender manual PAUSED");
            }
            else {
                log.i("Sender manual UN-PAUSED");
            }
        }
        this.senderPaused=suspended;
    }

    suspendListener(suspended: boolean) {
        if (this.listenerPaused != suspended) {
            if (suspended) {
                log.w("Listener manual PAUSED");
            }
            else if (this.smtpServer) {
                log.i("Listener manual UN-PAUSED");
            }
        }
        this.listenerPaused=suspended;
    }

    showSummary() {
        log.d("Summary:")
        if (this.smtpServer) {
            log.d("Listener Address:  "+this.config.listenerAddress);
            log.d("Listener Port:     "+this.config.listenerPort);
            log.d("Listener mode:     "+(this.config.listenerLmtp ? "LMTP" : "SMTP"));
            log.d("Listener TLS:      "+(this.config.listenerSecure ? "ENABLED" : "DISABLED"));
        }
        else {
            log.d("Listener:          DISABLED");
        }
        
        if (this.config.senderSmtpHost) {
            log.d("Sender host:       "+this.config.senderSmtpHost);
            log.d("Sender port:       "+this.config.senderSmtpPort);
            log.d("Sender mode:       "+(this.config.senderLmtp ? "SMTP" : "SMTP"));
            log.d("Sender TLS:        "+(this.config.senderSmtpSecure ? "ENABLED" : "DISABLED"));
            log.d("Sender Ignore CRT: "+(this.config.senderIgnoreInvalidCert ? "ENABLED" : "DISABLED"));
        }
        else {
            log.d("Sender:            DISABLED");
        }

        if (this.timerIntervalMs <= 0) {
            log.d("Timer:             DISABLED ("+MODE_DIRECT_FORWARD+" MODE)");
        }
        else if (this.timerIntervalMs > 0) {
            log.d("Timer:             "+(this.timerIntervalMs / 1000)+" Sec ("+MODE_TIMED+" MODE)");
            if (!this.isSenderReady()) {
                log.w("Timer is set but sender is disabled");
            }
        }
            
        log.d("Parking folder:    "+(this.emlParkingDir ? path.resolve(this.emlParkingDir) : "UNAVAILABLE"));
        log.d("Direct folder:     "+(this.emlDirectDir ? path.resolve(this.emlDirectDir) : "UNAVAILABLE"));

        if (this.listenerPaused) {
            log.w("Listener:          PAUSED");
        }
        if (this.senderPaused) {
            log.w("Sender:            PAUSED");
        }
    }
}
