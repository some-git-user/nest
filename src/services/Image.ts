import Image from '@/models/Image';
import { Types } from 'mongoose';

/**
 *  This function is used to get a single image
 *  @arg      imageId
 *  @returns  Image Doc
 */
export const getImage = async (imageId: string) =>
{
    const image = await Image.findById(new Types.ObjectId(imageId));

    return { image };
};

/**
 *  This function is used to get all images
 *  @returns  Images Doc Array
 */
export const getAllImages = async () =>
{
    const images = await Image.find();

    return { images };
};