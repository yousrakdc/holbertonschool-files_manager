import Bull from 'bull';
import { ObjectID } from 'mongodb';
import imageThumbnail from 'image-thumbnail';
import fs from 'fs';
import dbClient from './utils/db';

const fileQueue = new Bull('fileQueue');

const THUMBNAIL_WIDTHS = [500, 250, 100];

fileQueue.process(async (job) => {
  console.log('Processing job', job.id, job.data);

  const { fileId, userId } = job.data;

  if (!fileId) throw new Error('Missing fileId');
  if (!userId) throw new Error('Missing userId');

  const file = await dbClient.db.collection('files').findOne({
    _id: ObjectID(fileId),
    userId: ObjectID(userId),
  });

  if (!file) throw new Error('File not found');

  const thumbnailPromises = THUMBNAIL_WIDTHS.map(async (width) => {
    const thumbnail = await imageThumbnail(file.localPath, { width });
    const thumbnailPath = `${file.localPath}_${width}`;
    fs.writeFileSync(thumbnailPath, thumbnail);
  });

  await Promise.all(thumbnailPromises);

  console.log('Finished job', job.id);
});

fileQueue.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

fileQueue.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed:`, err.message);
});

export default fileQueue;
