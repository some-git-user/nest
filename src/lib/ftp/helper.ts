export const isImageFileName = (fileName) => {
    // Get the file extension by splitting the filename
    const fileExtension = fileName.split('.').pop().toLowerCase();

    // List of common image file extensions
    const imageExtensions = [ 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp' ];

    return { 
        isValidImage: imageExtensions.includes(fileExtension), 
        imageExtension: fileExtension 
    };
};
