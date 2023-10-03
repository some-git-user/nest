import Image from '@/models/Image';
import { Types } from 'mongoose';

/**
 *  This function is used to get a single image
 *  @arg      imageId
 *  @returns  Image Doc
 */
export const get = async (imageId: string) => {
    const image = await Image.findById(new Types.ObjectId(imageId));

    return { image };
};

/**
 *  This function is used to get all images
 *  @returns  Images Doc Array
 */
export const getAll = async () => {
    const images = await Image.find({limit: 100});

    return { images };
};

/**
 *  This function is used to create a single image
 *  @arg      data
 *  @returns  Image Doc
 */
export const create = async (data: typeof Image) => {
    const image = await Image.create(data);

    return { image };
};

/**
 *  This function is used to delete images
 *  @arg      data
 *  @returns  Image Doc
 */
export const deleteMany = async (data: string[]) => {
    const imageIds = (data).map(
        (imageIdsString) => new Types.ObjectId(imageIdsString),
    );
  
    const result = await Image.deleteMany({ _id: { $in: imageIds } });

    return result.deletedCount !== 0;
};