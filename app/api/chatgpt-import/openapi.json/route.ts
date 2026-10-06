import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    openapi: "3.1.0",
    info: { title: "myLibrary Shelfie Import", version: "1.0.0", description: "Send structured books detected from a shelfie to a one-time myLibrary import session." },
    servers: [{ url: "https://mylibrary-leste-gr.vercel.app" }],
    paths: {
      "/api/chatgpt-import": {
        post: {
          operationId: "importShelfieBooks",
          summary: "Import detected shelfie books into myLibrary",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["importCode", "books"],
                  properties: {
                    importCode: { type: "string", description: "The one-time code supplied by the user." },
                    books: {
                      type: "array",
                      minItems: 1,
                      maxItems: 100,
                      items: {
                        type: "object",
                        required: ["title", "author", "publisher", "language", "visibleIsbn", "confidence"],
                        properties: {
                          title: { type: "string" },
                          author: { type: "string" },
                          publisher: { type: ["string", "null"] },
                          language: { type: ["string", "null"] },
                          visibleIsbn: { type: ["string", "null"], description: "Only when ISBN digits are visible in the image." },
                          confidence: { type: "number", minimum: 0, maximum: 1 },
                        },
                        additionalProperties: false,
                      },
                    },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": { description: "Books imported successfully." },
            "400": { description: "Invalid book data." },
            "401": { description: "Invalid, expired, or previously used import code." },
          },
        },
      },
    },
  });
}
