import { getImage, getImages, createImage, deleteImages } from '@/controllers/images';
import express from 'express';

const router = express.Router();

// TODO add router protection

router
    .route('/')
    .get(getImages)
    .post(createImage)
    .delete(deleteImages);
    
router
    .route('/:imageId')
    .get(getImage);

export default router;