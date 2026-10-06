# Η βιβλιοθήκη μου — My Book Library

The complete source of the published book catalogue, prepared for GitHub Pages.
Plain HTML, CSS and JavaScript: no build step, npm packages, backend or API keys.

## Included

- `index.html` — page structure and metadata.
- `style.css` and `edition.css` — bookshop styling, responsive layouts, and edition-picker styles.
- `app.js` — search, filters, sorting, book details and incremental loading.
- `books.json` — all 166 catalogue entries.
- `isbn.json` — accepted ISBN-13 values keyed by physical-copy ID.
- `covers/` — 145 local cover images.
- `cover-sources.json` — cover provenance.
- `.nojekyll` — serve these static files without Jekyll processing.

The website files and images are unchanged from published source commit
`5c8e9d28ef6fbb449fdc9f77f56585af144e0215`; the original `dist/` contents have
been moved to the repository root for GitHub Pages. Hosting-specific settings
and Git history are not included in this portable export.

## Upload to GitHub

1. Extract this ZIP.
2. Create a repository, for example `lefteris-books`.
3. Upload the **contents** of the extracted folder into the repository root.
   `index.html` must be at the top level, alongside `covers/`.
   Do not upload the ZIP itself or nest everything inside another folder.
4. GitHub Desktop is convenient for uploading all 145 cover files together:
   clone the repository, copy the extracted contents into it, commit and push.
   With the browser uploader, split large file selections into smaller batches.

## Publish with GitHub Pages

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, set **Source → Deploy from a branch**.
3. Choose **main** and **/ (root)**, then **Save**.
4. When deployment completes, open the site link shown in that settings page.

A public repository works with GitHub Free. The site uses relative paths, so it
also works beneath a GitHub project repository path without changing the code.
No custom domain or paid service is required by this application.

Official setup guide:
https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## Run locally

From this folder, run:

```sh
python -m http.server 8000
```

Then open http://localhost:8000. Use a local HTTP server instead of double-clicking
`index.html`, because the application fetches `books.json`.

The edition picker uses ranked candidates from `data/isbn-mapping.json`. A selection
updates the visible ISBN and cover and is stored in that browser's local storage.
The static site cannot publish the selection back to the repository; the interface
marks local selections accordingly.

## Update your books

Edit `books.json` using a text or JSON editor. Preserve the record IDs (`B001`, etc.).
Each record represents one physical volume; duplicate titles can be intentional.
Add cover images in `covers/`, set a record's `cover` to its relative image path,
and set `coverSource` to the source page when available. Missing covers are
handled automatically. Commit and push changes to republish.

The Excel workbook is not connected to this site. Excel edits must be transferred
to `books.json` separately. The current catalogue has 21 records without covers;
some records still need bibliographic identification. Cover editions may differ
from the physical books. Original catalogue notes are retained.

## Fonts and credits

Fonts are loaded from Google Fonts, with local system font fallbacks. Cover
images are stored locally. Cover artwork remains the property of its respective
rights holders; source links are recorded in `cover-sources.json` and displayed
in book details. This export does not grant a separate license to that artwork.
