// import { FtpSrv, GeneralError } from 'ftp-srv';
import { FtpSrv } from 'ftp-srv';
// WORKAROUND for GeneralError https://github.com/QuorumDMS/ftp-srv/blob/575b41e039e6111eb27a7b6dd1e9b5bb182aa46d/ftp-srv.d.ts
import { env } from '@/config/env';
import customFileSystem from './ftp-filesystem';

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

    // Handle FTP server events
    ftpServer.on('login', async ({ connection, username, password }, resolve, reject) => { 
        if (username === 'anonymous' && password === 'anonymous') {
            customFileSystem.connection = connection;
            customFileSystem.root = process.cwd();
            customFileSystem.username = username;
    
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

