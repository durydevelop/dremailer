import { Writable } from "stream";
import fs from "fs";
/*
const COLOR_R="\x1b[31m";
const COLOR_Y="\x1b[33m";
const COLOR_M="\x1b[35m";
const COLOR_END="\x1b[0m";
*/
/**
 * Create a Writable stream that do nothing
 * @returns the Writable stream
 */
export function nullStream() : Writable {
    let nullStream=new Writable;
    nullStream._write = function (chunk, encoding, done) {
        done();
    };
    return nullStream;
}

export async function findFiles(folderPath: string, extFilter?: string) {

    return new Promise<string[]>((resolve, reject) => {
        fs.readdir(folderPath, {withFileTypes: true}, (err, files) => {
            if (err) {
                return reject(err);
            }   
            else {
                const filesQueue=files.filter(item => !item.isDirectory() && (extFilter ? (item.name.split('.').pop() == extFilter) : true)).map(item => item.name);
                //console.log("scanned "+folderPath);
                return resolve(filesQueue);
            }
        });
    });
}
