// import { FtpSrv, GeneralError } from 'ftp-srv';
import { FtpSrv } from 'ftp-srv';
// WORKAROUND for GeneralError https://github.com/QuorumDMS/ftp-srv/blob/575b41e039e6111eb27a7b6dd1e9b5bb182aa46d/ftp-srv.d.ts
import { Writable } from 'stream';
import fs from 'fs';
import { env } from '@/config/env';

// Create the FTP server instance
export const startFtpServer = () => {
    const ftpServer = new FtpSrv({
        url: `ftp://127.0.0.1:${env.FTP_PORT}`,
        // pasv_url: 'ftp://127.0.0.1:2121',
        greeting: 'Welcome to my FTP server!',
        whitelist: [ ],
        blacklist: [ 'RNFR', 'RNTO', 'RETR', 'CHMOD', 'SYST', 'RMD', 'DELE', 'SITE', 'MKD', 'PASV' ],
        anonymous: false,
    });

    const customFileSystem = {
        connection: null, 
        cwd: '/',
        root: '/', 
 
        async get(fileName) {
            console.log(fileName);
            
            return null; //TODO check if file exists in database
        },
        currentDirectory() {
            return this.cwd;
        },

        async list(path?: string) {
            console.log(path);
            return path;
        },

        async chdir(path?: string) {
            return path;
        },

        write(fileName: string, { append = false, start }){
            console.log(fileName, append, start);

            // Initialize a constant to store the file content
            const fileContent = [];

            return new Writable({
                write: (chunk, encoding, callback) => {
                    // Append the chunk data to the constant
                    fileContent.push(chunk);
                    callback();
                },
                // The 'finish' event is emitted when all data has been written
                // You can resolve or perform further actions here
                final: (callback) => {
                    // Join the chunks to get the complete file content
                    const completeContent = Buffer.concat(fileContent);
                    
                    const base64String = completeContent.toString('base64');

                    console.log('Base64-encoded content:', base64String);

                    // Get the size (in bytes) of the completeContent buffer
                    const fileSizeInBytes = completeContent.length;

                    console.log('File size in bytes:', fileSizeInBytes);

                    const filePath = 'output.txt';

                    fs.writeFile(filePath, base64String, (err) => {
                        if (err) {
                            console.error('Error writing file:', err);
                        } else {
                            console.log('File has been written successfully.');
                        }
                    });

                    //TODO store the file in the database
                    callback();
                },
            });
        },

        async read(fileName: string, { start }) {
            console.log(fileName, start);
            return fileName;
        },

        async delete(path: string) {
            this.connection.reply(550, 'Permission denied.');
            console.log(path);
        },

        async mkdir(path: string) {
            this.connection.reply(550, 'Permission denied.');
            console.log(path);
            return this.cwd;
        },

        async rename(from: string, to: string) {
            console.log(from, to);
            this.connection.reply(550, 'Permission denied.');
        },

        async chmod(path: string, mode: string) {
            console.log(path, mode);
            this.connection.reply(550, 'Permission denied.');
        },

        getUniqueName(fileName: string) {
            console.log(fileName);
            return fileName;
        }
    };

    // Handle FTP server events
    ftpServer.on('login', async ({ connection, username, password }, resolve, reject) => { 
        if (username === 'anonymous' && password === 'anonymous') {
            customFileSystem.connection = connection;
            customFileSystem.root = process.cwd();

            connection.on('data', (dataChunk) => {
                // Process the uploaded data chunk as needed
                console.log('Received data chunk:', dataChunk);
            });
    
            // The 'end' event indicates that the file upload has finished
            connection.on('end', () => {
                // Handle the file upload completion and return a response
                console.log('File upload completed');
                resolve({
                    fs: customFileSystem,
                });
            });
        
            return resolve({
                fs: customFileSystem,
            });
        }
        return reject(new Error('Invalid username or password'));
    });

    ftpServer.on('client-error', (error) => {
        console.error('FTP client error:', error);
    });

    // Start the FTP server
    ftpServer.listen()
        .then(() => {
            console.log(`FTP server listening on port ${env.FTP_PORT}`);
        })
        .catch((error) => {
            console.error('Error starting FTP server:', error);
        });
};

