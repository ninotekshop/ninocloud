// Nạp .env cho môi trường test — dùng đúng biến mà server thật dùng.
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '..', '.env') });
