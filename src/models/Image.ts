import mongoose, { HydratedDocument, Model } from 'mongoose';
import { EmptyObject } from '../@types/utils';

interface ImageBase {
  ftpUserName: string;
  imageName: string;
  imageSize: number;
  imageType: string;
  imageData: string;
}
/**
 * A model for a Image.
 * 1. Parameter -> Properties of a log
 * 2. Query Helpers -> not set
 * 3. Methods & Overrides -> not set
 * 4. Virtuals -> not set
 */
type ImageModel = Model<ImageBase, EmptyObject, EmptyObject, EmptyObject>;

const ImageSchema = new mongoose.Schema<ImageBase, ImageModel>(
    {
        ftpUserName: {
            type: String,
            required: true,
        },
        imageName: {
            type: String,
            required: true,
        },
        imageSize: {
            type: Number,
            required: true,
        },
        imageType: {
            type: String,
            required: true,
        },
        imageData: {
            type: String,
            required: true,
        },

    },
    {
        timestamps: true,
    },
);

/**
 * We don't extend the `Document` type because it has some problems and will be deprecated in future versions.
 * See: [Mongoose Docs](https://mongoosejs.com/docs/typescript.html#using-extends-document)
 */
export type IImage = HydratedDocument<ImageBase>;
const Image = mongoose.model<IImage>('image', ImageSchema);

export default Image;