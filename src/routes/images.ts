import { getImage, getImages } from '@/controllers/images';
import express from 'express';

const router = express.Router();

// TODO add router protection

router
    .route('/')
    .get(getImages);
    
router
    .route(
        '/:imageId',
    ).get(getImage);

export default router;