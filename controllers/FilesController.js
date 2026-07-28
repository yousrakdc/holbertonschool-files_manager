import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ObjectID } from 'mongodb';
import mime from 'mime-types';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const ACCEPTED_TYPES = ['folder', 'file', 'image'];

class FilesController {
  static async postUpload(req, res) {
    const token = req.headers['x-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await dbClient.db.collection('users').findOne({ _id: ObjectID(userId) });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const {
      name,
      type,
      parentId = 0,
      isPublic = false,
      data,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'Missing name' });
    if (!type || !ACCEPTED_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Missing type' });
    }
    if (!data && type !== 'folder') {
      return res.status(400).json({ error: 'Missing data' });
    }

    let parentObjectId = 0;
    if (parentId && parentId !== '0' && parentId !== 0) {
      let parentFile;
      try {
        parentObjectId = ObjectID(parentId);
        parentFile = await dbClient.db.collection('files').findOne({ _id: parentObjectId });
      } catch (err) {
        return res.status(400).json({ error: 'Parent not found' });
      }
      if (!parentFile) return res.status(400).json({ error: 'Parent not found' });
      if (parentFile.type !== 'folder') {
        return res.status(400).json({ error: 'Parent is not a folder' });
      }
    }

    const fileDocument = {
      userId: ObjectID(userId),
      name,
      type,
      isPublic,
      parentId: parentObjectId === 0 ? 0 : parentObjectId,
    };

    if (type === 'folder') {
      const result = await dbClient.db.collection('files').insertOne(fileDocument);
      return res.status(201).json({
        id: result.insertedId,
        userId,
        name,
        type,
        isPublic,
        parentId: fileDocument.parentId,
      });
    }

    const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const localPath = path.join(folderPath, uuidv4());
    const fileBuffer = Buffer.from(data, 'base64');
    fs.writeFileSync(localPath, fileBuffer);

    fileDocument.localPath = localPath;

    const result = await dbClient.db.collection('files').insertOne(fileDocument);

    return res.status(201).json({
      id: result.insertedId,
      userId,
      name,
      type,
      isPublic,
      parentId: fileDocument.parentId,
      localPath,
    });
  }

  static async getShow(req, res) {
    const token = req.headers['x-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await dbClient.db.collection('users').findOne({ _id: ObjectID(userId) });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;

    let file;
    try {
      file = await dbClient.db.collection('files').findOne({
        _id: ObjectID(id),
        userId: ObjectID(userId),
      });
    } catch (err) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (!file) return res.status(404).json({ error: 'Not found' });

    return res.status(200).json(file);
  }

  static async getIndex(req, res) {
    const token = req.headers['x-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await dbClient.db.collection('users').findOne({ _id: ObjectID(userId) });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { parentId = 0, page = 0 } = req.query;

    let matchParentId;
    if (parentId === 0 || parentId === '0') {
      matchParentId = 0;
    } else {
      try {
        matchParentId = ObjectID(parentId);
      } catch (err) {
        return res.status(200).json([]);
      }
    }

    const pageNumber = Number.isNaN(Number(page)) ? 0 : Number(page);

    const files = await dbClient.db.collection('files').aggregate([
      { $match: { userId: ObjectID(userId), parentId: matchParentId } },
      { $skip: pageNumber * 20 },
      { $limit: 20 },
    ]).toArray();

    return res.status(200).json(files);
  }

  static async putPublish(req, res) {
    const token = req.headers['x-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await dbClient.db.collection('users').findOne({ _id: ObjectID(userId) });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;

    let file;
    try {
      file = await dbClient.db.collection('files').findOne({
        _id: ObjectID(id),
        userId: ObjectID(userId),
      });
    } catch (err) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (!file) return res.status(404).json({ error: 'Not found' });

    await dbClient.db.collection('files').updateOne(
      { _id: ObjectID(id) },
      { $set: { isPublic: true } },
    );

    const updatedFile = await dbClient.db.collection('files').findOne({ _id: ObjectID(id) });

    return res.status(200).json(updatedFile);
  }

  static async putUnpublish(req, res) {
    const token = req.headers['x-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await dbClient.db.collection('users').findOne({ _id: ObjectID(userId) });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;

    let file;
    try {
      file = await dbClient.db.collection('files').findOne({
        _id: ObjectID(id),
        userId: ObjectID(userId),
      });
    } catch (err) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (!file) return res.status(404).json({ error: 'Not found' });

    await dbClient.db.collection('files').updateOne(
      { _id: ObjectID(id) },
      { $set: { isPublic: false } },
    );

    const updatedFile = await dbClient.db.collection('files').findOne({ _id: ObjectID(id) });

    return res.status(200).json(updatedFile);
  }

  static async getFile(req, res) {
    const { id } = req.params;

    let file;
    try {
      file = await dbClient.db.collection('files').findOne({ _id: ObjectID(id) });
    } catch (err) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (!file) return res.status(404).json({ error: 'Not found' });

    if (!file.isPublic) {
      const token = req.headers['x-token'];
      let userId = null;
      if (token) userId = await redisClient.get(`auth_${token}`);

      if (!userId || userId !== file.userId.toString()) {
        return res.status(404).json({ error: 'Not found' });
      }
    }

    if (file.type === 'folder') {
      return res.status(400).json({ error: 'A folder doesn\'t have content' });
    }

    if (!file.localPath || !fs.existsSync(file.localPath)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const mimeType = mime.lookup(file.name) || 'application/octet-stream';
    const content = fs.readFileSync(file.localPath);

    res.setHeader('Content-Type', mimeType);
    return res.status(200).send(content);
  }
}

export default FilesController;
