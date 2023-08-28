import { getAllImages, getImage as getImageById } from '@/services/Image';
import createHttpError from 'http-errors';
import { Request, Response, NextFunction } from 'express';

// @desc     Get single image
// @route    GET /api/v1/image/:imageId
export const getImage = async (req: Request, res: Response, next: NextFunction) => {
    const { imageId } = req.params;

    try {
        const { image } = await getImageById(
            imageId,
        );

        res.status(200).json({ success: true, data: image });
    } catch (error) {
        return next(createHttpError(404, error as string));
    }
};

// @desc     Get all images
// @route    GET /api/v1/image/
export const getImages = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const images = await getAllImages();

        res.status(200).json({ success: true, data: images });
    } catch (error) {
        return next(createHttpError(404, error as string));
    }
};