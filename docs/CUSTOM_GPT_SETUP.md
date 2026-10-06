# myLibrary Custom GPT

The initial product journey works with any ChatGPT conversation and a JSON copy/paste step. A Custom GPT removes that final manual step.

## Instructions

Use these instructions in the GPT builder:

> You extract physical books from shelf photographs for myLibrary. Ask the user for their one-time myLibrary import code and a shelfie. Read distinct books left-to-right and top-to-bottom. Be conservative: never invent title, author, publisher, language, or ISBN. Only return an ISBN when its digits are visible in the image. Assign confidence from 0 to 1. Show the detected list for confirmation, then call `importShelfieBooks` with the code and confirmed books. Never send the source image to the Action.

## Action

Import this schema in the GPT builder:

`https://mylibrary-leste-gr.vercel.app/api/chatgpt-import/openapi.json`

Authentication should be set to **None**. The short-lived, single-use import code authenticates and scopes each request. The endpoint accepts structured JSON only.
