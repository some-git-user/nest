import { FtpSrv, GeneralError } from 'ftp-srv';
// WORKAROUND for GeneralError https://github.com/QuorumDMS/ftp-srv/blob/575b41e039e6111eb27a7b6dd1e9b5bb182aa46d/ftp-srv.d.ts
import path from 'path';
import fs from 'fs';
import { env } from '@/config/env';

// Create the FTP server instance
export const startFtpServer = () => {
    const ftpServer = new FtpSrv({
        url: `ftp://127.0.0.1:${env.FTP_PORT}`,
        // pasv_url: 'ftp://127.0.0.1:2121',
        greeting: 'Welcome to my FTP server!',
        whitelist: [ ],
        blacklist: [ 'RNFR', 'RNTO', 'RETR', 'CHMOD', 'SYST', 'LIST', 'RMD', 'DELE', 'SITE', 'MKD', 'PASV' ],
        anonymous: false
    });

    // Handle FTP server events
    ftpServer.on('login', async ({ connection, username, password }, resolve, reject) => { 
        if(username === 'anonymous' && password === 'anonymous'){
            const rootDir = process.cwd(); // Get the current working directory
            const userRoot = path.join(rootDir, 'ftp-root'); // Use path.join to ensure correct separators
            console.log(connection);

            // Check if the userRoot directory exists, and create it if it doesn't
            if (!fs.existsSync(userRoot)) {
                try {
                    await fs.promises.mkdir(userRoot, { recursive: true }); // Create directory recursively
                } catch (error) {
                    console.error('Error creating directory:', error);
                    return reject(error);
                }
            }
      
            return resolve({ root: userRoot });    
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

