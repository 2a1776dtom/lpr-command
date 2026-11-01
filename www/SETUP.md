# Setup

Command works on this phone and in a desktop browser with no account. Nothing is sent anywhere until you paste an Appwrite endpoint and project id in Setup, and sync only runs after an API key is saved too.

## Run it on a computer

```bash
npm install
npm test
npm start
```

Open http://127.0.0.1:43123

The same files in `www/` are the static build. A local server is the reliable way to open them. Chrome can also open `www/index.html` as a file. If the browser will not save, use the local server or Download backup in Setup.

On an iPhone, before TestFlight, you can open that same URL in Safari and use Share, then Add to Home Screen.

## Appwrite (free plan)

1. Create a free account at https://cloud.appwrite.io
2. Create a project named Command.
3. Copy the Project ID. The API endpoint is `https://cloud.appwrite.io/v1`
4. Create a database with id `command`.
5. Create the collections below. Attribute names must match. String sizes can be lowered if the console rejects a size. Use the largest size it allows.
6. In Appwrite, create an API key with scopes `databases.read` and `databases.write` for that database. Create a second key for the assistant bot. You can turn either key off in the console at any time.
7. In Command, open Setup. Paste the endpoint, project id, database id (`command`), and the phone's API key. Tap Save, then Sync now.

The key stays in this browser only. It is not written into a backup file. Do not commit a key to git.

Until those fields are saved, the app is fully local (IndexedDB, with localStorage as a fallback).

### Collections

Database id: `command`

**decisions**

| Attribute | Type | Size |
| --- | --- | --- |
| title | string | 500 |
| question | string | 2000 |
| area | string | 32 |
| urgency | string | 16 |
| options | string | 8000 |
| recommendedId | string | 64 |
| chosenId | string | 64 |
| comment | string | 4000 |
| raised | string | 32 |
| due | string | 32 |
| status | string | 16 |
| note | string | 4000 |
| said | string | 4000 |
| sample | boolean | |
| source | string | 32 |
| sourceKey | string | 200 |
| updatedAt | string | 40 |

**thoughts**

Brandon writes these. Bots read them and can pick one up.

| Attribute | Type | Size |
| --- | --- | --- |
| title | string | 300 |
| text | string | 9000 |
| created | string | 40 |
| updated | string | 40 |
| status | string | 32 |
| tags | string | 1000 |
| area | string | 32 |
| owner_bot | string | 80 |
| bot_notes | string | 9000 |
| linked_decision_id | string | 64 |

`status` is one of `New`, `Picked up`, `In progress`, `Done`, `Parked`.

`tags` is a JSON array of strings, for example `["clinic","idea"]`.

`bot_notes` is a JSON array. Each item is `{"bot":"Chief of Staff","time":"2026-10-31T18:00:00.000Z","text":"I will draft an outline."}`. A reply from Brandon uses `"bot":"Brandon"`.

`area` is `Clinic`, `Money`, `Home`, `Product`, `Bots/System`, or empty.

Add a key index on `status` so a bot can list new thoughts.

If the console rejects a string size, use the largest it allows. The phone keeps the full text either way.

**maps**

| Attribute | Type | Size |
| --- | --- | --- |
| title | string | 300 |
| sheetTitle | string | 300 |
| source | string | 300 |
| rootId | string | 64 |
| palette | string | 1000 |
| rels | string | 8000 |
| updatedAt | string | 40 |

**nodes**

| Attribute | Type | Size |
| --- | --- | --- |
| mapId | string | 64 |
| parentId | string | 64 |
| title | string | 7000 |
| note | string | 7000 |
| color | string | 16 |
| todo | boolean | |
| done | boolean | |
| collapsed | boolean | |
| decisionId | string | 64 |
| sortOrder | integer | |
| labels | string | 1000 |
| priority | integer | |
| due | string | 32 |
| href | string | 500 |
| kind | string | 32 |
| folded | boolean | |
| dx | float | |
| dy | float | |
| updatedAt | string | 40 |

**todos** (a flat copy of to-do branches so a bot can list them without walking a map)

| Attribute | Type | Size |
| --- | --- | --- |
| mapId | string | 64 |
| nodeId | string | 64 |
| mapTitle | string | 300 |
| title | string | 500 |
| done | boolean | |
| due | string | 32 |
| priority | integer | |
| updatedAt | string | 40 |

**top3**

| Attribute | Type | Size |
| --- | --- | --- |
| slot | integer | |
| text | string | 300 |
| sample | boolean | |
| refType | string | 16 |
| refId | string | 64 |
| updatedAt | string | 40 |

Document ids are `top1`, `top2`, and `top3`.

**home_feed**

One document, id `current`.

| Attribute | Type | Size |
| --- | --- | --- |
| payload | string | 16000 |
| updatedAt | string | 40 |

`payload` is the home object (meals, projects, fun money) as JSON. The home assistant can keep writing the JSON file now. The same fields move to this document later. See `docs/home_feed.schema.json`.

Required indexes: add a key index on `nodes.mapId` and `todos.mapId` so the sync query can filter. Appwrite needs an index before an `equal` query on that attribute.

Document permissions can stay empty when you use an API key. The key bypasses collection permissions.

## Home feed

Schema: `docs/home_feed.schema.json`. A real example is `fixtures/home_items.json`.

Load it in the app with Setup, then Load home feed.

What the importer accepts:

- `meal_prep.plan`, `meals`, or `week` is this week's list and wins over older plans.
- If those are missing, a key like `last_plan_2026-10-16` is used. The latest date wins.
- A meal may use `meal`, `name`, or `title`. Servings may be a number or a string.
- A project needs a title (or `name`). `files`, `file`, and `path` are the same. `next` and `next_step` are the same.
- A project becomes a Home decision when `choice` is true, the status contains "waiting", or the next step says decide, whether, or says go. `choice: false` keeps it off the decision list.
- Loading the file again does not overwrite a decision you already have, and it keeps shopping checkboxes for the same meal name.
- `fun_money.tsla_shares` (or `tsla`) may be a number or a string. `rules` may be a string or a list of lines.
- Extra fields are ignored.

The three calls from the current feed are: export the Adirondack SVG, build the pain program, and HELOC or a home equity loan. They are Home area decisions, not sample data. The Clinic, Money, Product, and Bots/System cards labeled Sample are fillers until you replace them.

## Bot REST shape

Base URL: `https://cloud.appwrite.io/v1`

Headers on every call:

```
X-Appwrite-Project: YOUR_PROJECT_ID
X-Appwrite-Key: YOUR_BOT_API_KEY
Content-Type: application/json
```

List open decisions:

```bash
curl -s \
  -H "X-Appwrite-Project: YOUR_PROJECT_ID" \
  -H "X-Appwrite-Key: YOUR_BOT_API_KEY" \
  "https://cloud.appwrite.io/v1/databases/command/collections/decisions/documents?queries[0]=$(python3 -c 'import urllib.parse,json; print(urllib.parse.quote(json.dumps({"method":"equal","attribute":"status","values":["open"]})))')"
```

Create a decision. `documentId` must be 1 to 36 letters, numbers, dot, hyphen, or underscore, and it must start with a letter or number. `options` is a JSON string, not a nested array.

```bash
curl -s -X POST \
  -H "X-Appwrite-Project: YOUR_PROJECT_ID" \
  -H "X-Appwrite-Key: YOUR_BOT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "botdecision1",
    "data": {
      "title": "Order the ply this week?",
      "question": "Order the 3/4 inch ply this week?",
      "area": "Home",
      "urgency": "Soon",
      "options": "[{\"id\":\"oa\",\"label\":\"Order it\"},{\"id\":\"ob\",\"label\":\"Wait\"}]",
      "recommendedId": "oa",
      "chosenId": "",
      "comment": "",
      "raised": "2026-11-01",
      "due": "",
      "status": "open",
      "note": "",
      "said": "",
      "sample": false,
      "source": "bot",
      "sourceKey": "",
      "updatedAt": "2026-11-01T16:00:00.000Z"
    }
  }' \
  "https://cloud.appwrite.io/v1/databases/command/collections/decisions/documents"
```

Record his pick:

```bash
curl -s -X PATCH \
  -H "X-Appwrite-Project: YOUR_PROJECT_ID" \
  -H "X-Appwrite-Key: YOUR_BOT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"data":{"chosenId":"oa","status":"decided","updatedAt":"2026-11-01T18:00:00.000Z"}}' \
  "https://cloud.appwrite.io/v1/databases/command/collections/decisions/documents/botdecision1"
```

Clear the pick by PATCHing `chosenId` to `""` and `status` to `"open"`.

### Thoughts

List thoughts whose status is New:

```bash
curl -s \
  -H "X-Appwrite-Project: YOUR_PROJECT_ID" \
  -H "X-Appwrite-Key: YOUR_BOT_API_KEY" \
  "https://cloud.appwrite.io/v1/databases/command/collections/thoughts/documents?queries[0]=$(python3 -c 'import urllib.parse,json; print(urllib.parse.quote(json.dumps({"method":"equal","attribute":"status","values":["New"]})))')"
```

Read one thought, append your note to `bot_notes`, and PATCH the document. Set `owner_bot` to your name when you pick it up. Set `updated` to the current UTC time. Last write wins on that field.

```bash
curl -s -X PATCH \
  -H "X-Appwrite-Project: YOUR_PROJECT_ID" \
  -H "X-Appwrite-Key: YOUR_BOT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "status": "Picked up",
      "owner_bot": "Chief of Staff",
      "updated": "2026-10-31T18:00:00.000Z",
      "bot_notes": "[{\"bot\":\"Chief of Staff\",\"time\":\"2026-10-31T18:00:00.000Z\",\"text\":\"I will draft an outline. https://example.com/plan\"}]"
    }
  }' \
  "https://cloud.appwrite.io/v1/databases/command/collections/thoughts/documents/THOUGHT_ID"
```

Change status the same way. Use `In progress`, `Done`, or `Parked` when the work moves.

Turn a thought into a decision: create a decision (see above) with `source` set to `thought` and `sourceKey` set to the thought id. Then PATCH the thought:

```bash
curl -s -X PATCH \
  -H "X-Appwrite-Project: YOUR_PROJECT_ID" \
  -H "X-Appwrite-Key: YOUR_BOT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"data":{"status":"Picked up","linked_decision_id":"botdecision1","updated":"2026-10-31T18:05:00.000Z"}}' \
  "https://cloud.appwrite.io/v1/databases/command/collections/thoughts/documents/THOUGHT_ID"
```

Use two or four options on that decision. Put the thought text in `question`. Brandon can also tap Make a decision in the app. That does the same thing on the phone and syncs.

Delete:

```bash
curl -s -X DELETE \
  -H "X-Appwrite-Project: YOUR_PROJECT_ID" \
  -H "X-Appwrite-Key: YOUR_BOT_API_KEY" \
  "https://cloud.appwrite.io/v1/databases/command/collections/decisions/documents/botdecision1"
```

Areas: `Clinic`, `Money`, `Home`, `Product`, `Bots/System`.

Urgency: `Urgent`, `Soon`, `Later`, `Waiting`.

Status: `open` or `decided`.

Open to-dos are documents in `todos` where `done` is false. Maps are one `maps` document plus one `nodes` document per branch (`mapId` points at the map). Last write wins by the `updatedAt` string.

The phone pulls remote rows whose `updatedAt` is newer, and pushes local rows that are newer. Give the bot its own key so you can shut the bot off without locking the phone.

## iPhone build (Codemagic and TestFlight)

This matches the ARM Exam workflow.

1. In the Apple Developer account, register the bundle id `com.brandonfromm.command`.
2. In App Store Connect, create the app Command. Copy the numeric Apple ID from App Information into `codemagic.yaml` as `APP_STORE_APPLE_ID` (it is `0000000000` until you replace it).
3. In Codemagic, use the same App Store Connect integration `loadshare_asc` and the env group `code_signing` that ARM Exam uses.
4. The iOS project is produced with Capacitor 8:

```bash
npm install
npx cap add ios
npx cap sync ios
```

`npx cap add ios` only needs to happen once. Codemagic runs `npx cap sync ios` on every build.

5. Push the repo. In Codemagic, start the workflow `ios-testflight`. It does not start on every git push.
6. `submit_to_testflight` is `false`, same as ARM Exam, so Codemagic builds the IPA and does not upload it yet. Set that flag to `true` when you want the build sent to TestFlight. The export option `testFlightInternalTestingOnly` is already set.

There is no patient data in this app. Do not put chart notes or patient names in decisions.
