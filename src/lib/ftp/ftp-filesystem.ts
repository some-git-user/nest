import Image from '@/models/Image';
import { push } from '@/lib/queue/imageQueue';
import { Writable } from 'stream';
import { isImageFileName } from './helper';
import { env } from '@/config/env';

const customFileSystem = {
    connection: null, 
    cwd: '/',
    root: '/', 
    username: null,

    async get() {
        // will always return null, so client can upload files with the same name
        return null;
    },
    currentDirectory() {
        return this.cwd;
    },

    async list(path?: string) {
        return path;
    },

    async chdir(path?: string) {
        return path;
    },

    write(fileName: string){
        // Initialize a constant to store the file content
        const fileContent = [];
        let fileExtension = null;
        // Set the maximum allowed size in bytes (10 MB)
        const maxSize = Number(env.FTP_MAX_UPLOAD_SIZE);

        let currentSize = 0;

        const writableStream = new Writable({ write: (chunk, encoding, callback) => {
            const { isValidImage, imageExtension } = isImageFileName(fileName);
            if (!isValidImage) {
                // Emit an error to signal the transaction should be aborted
                const error = new Error('Unsupported filetype');
                writableStream.emit('error', error);
                callback(error);
            }
            currentSize += chunk.length;
            // Append the chunk data to the constant
            fileContent.push(chunk);
            fileExtension = imageExtension;

            if (currentSize > maxSize) {
                // Emit an error to signal the transaction should be aborted
                const error = new Error(`Transaction size exceeds ${env.FTP_MAX_UPLOAD_SIZE} bytes`);
                writableStream.emit('error', error);
                callback(error);                    }
            callback();
        },
        // The 'finish' event is emitted when all data has been written
        final: (callback) => {
            // Join the chunks to get the complete file content
            const completeContent = Buffer.concat(fileContent);
            const fileSizeInBytes = completeContent.length;
            const base64String = completeContent.toString('base64');

            const newImage = new Image({
                ftpUserName: this.username,
                imageData: base64String,
                imageName: fileName,
                imageType: fileExtension,
                imageSize: fileSizeInBytes,
            });

            push(newImage);

            callback();
        },
        });

        // Handle errors if the transaction is aborted
        writableStream.on('error', (error) => {
            console.error(error.message);
            // You can take further actions here if needed
        });
      
        return writableStream;
    },

    async read(fileName: string) {
        return fileName;
    },

    async delete() {
        this.connection.reply(550, 'Permission denied.');
    },

    async mkdir() {
        this.connection.reply(550, 'Permission denied.');
        return this.cwd;
    },

    async rename() {
        this.connection.reply(550, 'Permission denied.');
    },

    async chmod() {
        this.connection.reply(550, 'Permission denied.');
    },

    getUniqueName(fileName: string) {
        return fileName;
    }
};

export default customFileSystem;