const queue = [];

export const push = (image) => {
    queue.push(image);
    console.log(queue);
};

// TODO https://github.com/gemini-testing/looks-same   https://github.com/reg-viz/img-diff-js
export const compareImages = async (img1: string, img2: string): Promise<boolean> => {
    // read images from internet
    const [ img1Resp, img2Resp ] = await Promise.all([ axios.get(img1, { responseType: 'arraybuffer' }), axios.get(img2, { responseType: 'arraybuffer' }) ]);
    // convert them to buffer
    const img1Buffer = Buffer.from(img1Resp.data, 'binary');
    const img2Buffer = Buffer.from(img2Resp.data, 'binary');
    const { equal } = await looksSame(img1Buffer, img2Buffer);
    return equal;
};