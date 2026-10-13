import { mkdirSync, copyFileSync } from 'node:fs';
mkdirSync('public',{recursive:true});copyFileSync('index.html','public/index.html');
