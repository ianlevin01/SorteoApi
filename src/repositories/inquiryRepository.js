import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb } from '../config/aws.js';
import { TABLES, INDEXES } from '../config/tables.js';
import { buildUpdateExpression } from '../lib/dynamoUpdate.js';

export async function createInquiry(inquiry) {
  await ddb.send(
    new PutCommand({
      TableName: TABLES.inquiries,
      Item: inquiry,
      ConditionExpression: 'attribute_not_exists(inquiryId)',
    }),
  );
  return inquiry;
}

export async function getInquiry(inquiryId) {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: TABLES.inquiries, Key: { inquiryId } }),
  );
  return Item || null;
}

export async function updateInquiry(inquiryId, patch) {
  const expr = buildUpdateExpression(patch);
  const { Attributes } = await ddb.send(
    new UpdateCommand({
      TableName: TABLES.inquiries,
      Key: { inquiryId },
      ...expr,
      ConditionExpression: 'attribute_exists(inquiryId)',
      ReturnValues: 'ALL_NEW',
    }),
  );
  return Attributes;
}

export async function listInquiriesByStatus(status) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: TABLES.inquiries,
      IndexName: INDEXES.inquiriesByStatus,
      KeyConditionExpression: '#s = :s',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': status },
      ScanIndexForward: false, // más recientes primero
    }),
  );
  return Items || [];
}

export async function addMessage(message) {
  await ddb.send(
    new PutCommand({
      TableName: TABLES.inquiryMessages,
      Item: message,
      ConditionExpression: 'attribute_not_exists(inquiryId)',
    }),
  );
  return message;
}

export async function listMessages(inquiryId) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: TABLES.inquiryMessages,
      KeyConditionExpression: 'inquiryId = :i',
      ExpressionAttributeValues: { ':i': inquiryId },
      ScanIndexForward: true, // orden cronológico
    }),
  );
  return Items || [];
}
