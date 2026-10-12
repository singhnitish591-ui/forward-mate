// tests/fixtures/payloads.js
// Realistic Telegram channel_post and message update fixtures for testing.

export const plainCodePayload = {
  update_id: 10001,
  channel_post: {
    message_id: 101,
    chat: { id: -100111222333, title: 'Deals Source', type: 'channel' },
    date: 1710000000,
    text: 'Flash Sale! Use code: SAVE20 for flat 20% discount on all items.',
  },
};

export const codeWithUrlPayload = {
  update_id: 10002,
  channel_post: {
    message_id: 102,
    chat: { id: -100111222333, title: 'Deals Source', type: 'channel' },
    date: 1710000005,
    text: 'Mega Offer! Use code SAVE30 at https://deals.example.com/checkout now!',
    entities: [
      {
        type: 'url',
        offset: 31,
        length: 33,
      },
    ],
  },
};

export const multipleUrlsPayload = {
  update_id: 10003,
  channel_post: {
    message_id: 103,
    chat: { id: -100111222333, title: 'Deals Source', type: 'channel' },
    date: 1710000010,
    text: 'Check https://store.com and www.deals.org or t.me/promochannel for more!',
  },
};

export const urlOnlyPayload = {
  update_id: 10004,
  channel_post: {
    message_id: 104,
    chat: { id: -100111222333, title: 'Deals Source', type: 'channel' },
    date: 1710000015,
    text: 'https://onlyurl.com/something',
    entities: [{ type: 'url', offset: 0, length: 29 }],
  },
};

export const photoWithUrlCaptionPayload = {
  update_id: 10005,
  channel_post: {
    message_id: 105,
    chat: { id: -100111222333, title: 'Deals Source', type: 'channel' },
    date: 1710000020,
    photo: [
      { file_id: 'photo_thumb_123', width: 90, height: 90 },
      { file_id: 'photo_highres_456', width: 800, height: 800 },
    ],
    caption: 'New Sneaker Drop! Buy at https://shop.com/sneakers using CODE: SNEAK25',
    caption_entities: [{ type: 'url', offset: 25, length: 24 }],
  },
};

export const videoCaptionPayload = {
  update_id: 10006,
  channel_post: {
    message_id: 106,
    chat: { id: -100111222333, title: 'Deals Source', type: 'channel' },
    date: 1710000022,
    video: {
      file_id: 'video_file_999',
      duration: 45,
      width: 1280,
      height: 720,
    },
    caption: 'Unboxing Video! Check details at https://video.example.com and use code TECH50',
    caption_entities: [{ type: 'url', offset: 33, length: 25 }],
  },
};

export const documentPayload = {
  update_id: 10007,
  channel_post: {
    message_id: 107,
    chat: { id: -100111222333, title: 'Deals Source', type: 'channel' },
    date: 1710000025,
    document: {
      file_id: 'doc_file_789',
      file_name: 'Catalog_2026.pdf',
      mime_type: 'application/pdf',
    },
    caption: 'Catalog attached. Visit https://catalog.example.com to see more.',
  },
};

export const protectedContentPayload = {
  update_id: 10008,
  channel_post: {
    message_id: 108,
    chat: { id: -100111222333, title: 'Deals Source', type: 'channel' },
    date: 1710000030,
    has_protected_content: true,
    text: 'Restricted post with protected content flag.',
  },
};
