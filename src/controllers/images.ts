import { create, deleteMany, getAll, get as getImageById } from '@/services/Image';
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
        const images = await getAll();

        res.status(200).json({ success: true, data: images });
    } catch (error) {
        return next(createHttpError(404, error as string));
    }
};

// @desc     Create a image
// @route    POST /api/v1/image
// @access   Private TODO
export const createImage = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const image = await create(req.body);
        console.log(image);

        res.status(201).json({ success: true, data: image });
    } catch (error) {
        return next(createHttpError(400, error as string));
    }
};
  
/**
   * @desc   Delete one or many images
   * @route  DELETE /api/v1/image
   * @body   { imageIds: string[] }
   */
export const deleteImages = async (req: Request, res: Response, next: NextFunction) => {
    const response = {code: 200, message: 'Successfully deleted!'};
    try {
        const result = await deleteMany(req.body.imageIds);
        if (!result) {
            response.code = 400;
            response.message = `Object ${req.body.imageIds} not found!`;
        }
        console.log(response);
  
        res.status(response.code).json({ success: true, data: { message: response.message }});
    } catch (error) {
        return next(createHttpError(400, (error).message));
    }
};