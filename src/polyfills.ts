import { Buffer } from 'buffer';
import process from 'process';

if (typeof window !== 'undefined') {
    (window as any).global = window;
    (window as any).Buffer = Buffer;
    (window as any).process = process;
    // Some libraries check for global.process or global.Buffer specifically
    (window as any).global.Buffer = Buffer; 
    (window as any).global.process = process;
}