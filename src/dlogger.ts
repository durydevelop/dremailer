import fss from "fs";
import {once} from 'events';
import util from "util";
import tz from "date-fns/format";

// Color constants
const CL_W_ON_R  = "\x1b[1;41m";
const CL_RED     = "\x1b[31m";
const CL_GREEN   = "\x1b[32m";
const CL_YELLOW  = "\x1b[33m";
const CL_BLUE    = "\x1b[34m";
const CL_MAGENTA = "\x1b[35m";
const CL_CYAN    = "\x1b[36m";
const CL_END     = "\x1b[0m";

enum DLogLevel { DEBUG="DEBUG", INFO="INFO", WARNING="WARNING", ERROR="ERROR", NONE="NONE" };
enum DLogColor { DEBUG=CL_CYAN, INFO=CL_GREEN, WARNING=CL_YELLOW, ERROR=CL_RED, NONE=CL_END };

// Status
interface DStatus { ready: boolean, message: string };

// Config
export interface DLoggerConfig {
    filename?: fss.PathLike,
    showStartTag?: boolean;
    showLevel?: boolean;
    showTimeStamp?: boolean;
    enableConsole?: boolean;
    enableColors?: boolean;
}

export class DLogger {
    private config: DLoggerConfig;
    private fileStream: fss.WriteStream | undefined = undefined;
    public startTag="";

    // Initial status
    public status: DStatus = { ready: false, message: "Need to call init() before use this class" };

    constructor(config: DLoggerConfig) {
        this.config=config;
    }
    
    init(): DLogger {
        if (this.config.filename) {
            if (fss.existsSync(this.config.filename) && !fss.statSync(this.config.filename).isFile()) {
                // Exists but not a file
                this.fileStream=undefined;
                this.status={ ready: false, message: "<"+this.config.filename+"> is not a file"}
            }
            else {
                // Create/open stream
                this.fileStream=fss.createWriteStream(this.config.filename,{flags:"a"});
                this.status={ ready:true, message: "Init success" };
            }

            //this.showSummary();
        }
        return this;
    }

    getSummary() {
        let summary:string[] = [
            "fileStream:      "+(this.fileStream ? this.config.filename : "DISABLED"),
            "show start tag:  "+(this.config.showStartTag ? "ENABLED" : "DISABLED"),
            "show time stamp: "+(this.config.showTimeStamp ? "ENABLED" : "DISABLED"),
            "show level:      "+(this.config.showLevel ? "ENABLED" : "DISABLED"),
            "console:         "+(this.config.enableConsole ? "ENABLED" : "DISABLED"),
        ]
        return summary;
    }

    private write(msg: string, value?: any, startTag?: string, level?: DLogLevel) {
        // Prepare time stamp string (to send the same to console)
        const timeStamp: string =this.config.showTimeStamp ? now() : "";
        let logMsg=msg;
        if (this.fileStream) {
            // Write to file
            const firstTag=startTag ? startTag : "";
            const levelTag=level? DLogLevel[level] : "";
            if (value === null) {
                logMsg+=(null);
            }
            else if (value) {
                logMsg+=" ("+util.inspect(value, { showHidden: false, depth: null, colors: false })+")";
            }

            let logLine: string =
                (this.config.showStartTag && firstTag ? "["+firstTag+"]" : "") +
                (this.config.showTimeStamp ? "["+timeStamp+"]" : "") +
                (this.config.showLevel ? "["+padLevel(levelTag)+"]" : "") +
                (logMsg + "\r");
                
            if (!this.fileStream.write(logLine+"\n")) {
                // TODO: await
                once(this.fileStream,"drain");
            }
        }

        if (this.config.enableConsole) {
            writeToConsole(
                msg,
                value,
                this.config.showStartTag ? startTag : "",
                this.config.showLevel ? level : undefined,
                timeStamp,
                this.config.enableColors
            )
        }

        return logMsg;
    }

    debug(msg: string, value?: any) {
        return this.write(msg,value,this.startTag,DLogLevel.DEBUG);
    }

    info(msg: string, value?: any) {
        return this.write(msg,value,this.startTag,DLogLevel.INFO);
    }

    warning(msg: string, value?: any) {
        return this.write(msg,value,this.startTag,DLogLevel.WARNING);
    }

    error(msg: string, value?: any) {
        return this.write(msg,value,this.startTag,DLogLevel.ERROR);
    }

    close() {
        //this.rStream.push(null);
        this.fileStream?.close();
    }

    // **************************** Static methods ****************************
    /**
     * Log a DEBUG message in console.
     * @param msg message to show.
     * @param value optional value to display as inspected variable.
     * @param startTag optional tag to print as first tag.
     * @returns formatted message without any tag.
     */
    static d(msg: string, value?: any, startTag?: string) {
        return(writeToConsole(msg,value,startTag,DLogLevel.DEBUG,true,true));
    }

    /**
     * Log an INFO message in console.
     * @param msg message to show.
     * @param value optional value to display as inspected variable.
     * @param startTag optional tag to print as first tag.
     * @returns formatted message without any tag.
     */
    static i(msg: string, value?: any, startTag?: string) {
        return(writeToConsole(msg,value,startTag,DLogLevel.INFO,true,true));
    }

    /**
     * Log a WARNING message in console.
     * @param msg message to show.
     * @param value optional value to display as inspected variable.
     * @param startTag optional tag to print as first tag.
     * @returns formatted message without any tag.
     */
    static w(msg: string, value?: any, startTag?: string) {
        return(writeToConsole(msg,value,startTag,DLogLevel.WARNING,true,true));
    }

    /**
     * Log an ERROR message in console.
     * @param msg message to show.
     * @param value optional value to display as inspected variable.
     * @param startTag optional tag to print as first tag.
     * @returns formatted message without any tag.
     */
    static e(msg: string, value?: any, startTag?: string) {
        return(writeToConsole(msg,value,startTag,DLogLevel.ERROR,true,true));
    }
    // ************************************************************************
}

/**
 * * Log a message to console.
 * 
 * @param msg message to show.
 * @param value optional value to display as inspected variable (if undefined will not shown).
 * @param startTag optional initial Tag.
 * @param level one of DLogLevel values.
 * @param timeStamp if not emty string, use it as time stamp, if true add now() as timestamp, otherwise time stamp is disabled.
 * @param enableColors if true colors are shown due the level.
 * @returns formatted message without any tag.
 */
function writeToConsole(msg: string, value?: any , startTag?: string, level?: DLogLevel, timeStamp?: string | boolean, enableColors?: boolean) {
    const firstTag=startTag ? "["+startTag+"]" : ""
    let timeTag: string ="";
    const cl=level && enableColors ? DLogColor[level] : "";
    if (timeStamp) {
        if (typeof timeStamp == "string") {
            timeTag="["+cl+timeStamp+CL_END+"]";
        }
        else {
            timeTag="["+cl+now()+CL_END+"]";
        }
    }
    
    const levelTag=level ? "["+cl+padLevel(level)+CL_END+"] " : "";
    let logMsg=msg;
    if (value === null) {
        logMsg+=(null);
    }
    else if (value) {
        logMsg+=" ("+util.inspect(value, { showHidden: false, depth: null, colors: enableColors })+")";
    }
    console.log(firstTag+timeTag+levelTag+logMsg);
    return logMsg;
}

function now() {
    return tz.format(Date.now(),"yyyy-MM-dd HH:mm:ss");
}

function padLevel(levelStr: string) {
    // TODO: center
    return levelStr.padEnd(7,' ');
}
