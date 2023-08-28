import { env } from 'config/env';
import mongoose from 'mongoose';

const connectMongoDB = async (): Promise<void> => {
    const conn = await mongoose.connect(env.MONGO_URI, {
        dbName: 'data',
    });
    
    console.log(`MongoDB Connected: ${conn.connection.host}`);
};

export default connectMongoDB;