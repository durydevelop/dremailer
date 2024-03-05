import express, { Request, Response, NextFunction } from "express";
import bodyParser from "body-parser"
import { DLogger as log } from "./dlogger";
import { DRemailer } from "./dremailer";

const PAYLOAD_LIMIT="10mb";

interface DRequestControl {
    start: boolean,
    stop: boolean,
    suspend_sender: boolean,
    suspend_listener: boolean,
}

const app=express();

export function startRemailerControlApi(remailer: DRemailer, port: number, apiKey: string) {
    app.use(bodyParser.json({ limit: PAYLOAD_LIMIT }));
    app.use(bodyParser.urlencoded({ limit: PAYLOAD_LIMIT, extended: true }));
    //app.use(bodyParser.raw({ limit: PAYLOAD_LIMIT }));

    app.post("/api/remailer/control", async (req,res) => {
        log.d("Remailer control request: ",req.body);
        let done=false;
        if (req.body.suspend_sender) {
            log.d("Requerst: suspend SENDER");
            remailer.suspendSender(req.body.suspend_sender == "true" ? true : false);
            done=true;
        }
        if (req.body.suspend_listener) {
            log.d("Request: suspend LISTENER");
            remailer.suspendListener(req.body.suspend_listener == "true" ? true : false);
            done=true;
        }

        if (done) {
            remailer.showSummary();
        }
        else {
            log.d("req.body",req.body);
            return res.sendStatus(400).json(log.e("Request unknown"));
        }

        return res.status(200).json("done");
    })

    app.get("/api/remailer/query/status", async (req,res) => {
        log.d("Remailer status request");
        return res.status(200).json(remailer.getSummary());
    });

    app.get("/api/remailer/query/storage", async (req,res) => {
        log.d("Remailer storage list request");
        await remailer.scanStorageAsync()
        .then((result) => {
            return res.status(200).json(result);    
        })
        .catch((err: Error) => {
            return res.status(400).json(err.message);
        })
    });

    app.listen(port, () => {
        log.d("app.listen()")
    });
}