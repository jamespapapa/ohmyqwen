┌─────────────────────────────────────────────────────────────────────────────┐
│                    OHMYQWEN ONTOLOGY GRAPH BIG PICTURE                     │
└─────────────────────────────────────────────────────────────────────────────┘

   ┌──────────────────────┐
   │   User / Operator    │
   │ ask / search /       │
   │ analyze / feedback   │
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │  Question Typing     │
   │  - flow              │
   │  - module-role       │
   │  - integration       │
   │  - overview          │
   │  - process/batch     │
   └──────────┬───────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ONTOLOGY QUERY PLANNER                           │
│                                                                             │
│  Select Projection -> Pick Anchor Nodes -> Traverse Edges -> Evidence Path │
└──────────┬──────────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             ONTOLOGY GRAPH CORE                            │
│                                                                             │
│  Nodes                                                                      │
│   - project / module / file / symbol / route / api-endpoint                │
│   - controller / service / dao-mapper / batch-job / queue / processor      │
│   - eai-interface / config / document / feedback-record                    │
│   - domain / subdomain / action / channel / module-role / process-role     │
│   - knowledge-cluster / replay-candidate / evaluation-artifact             │
│                                                                             │
│  Edges                                                                      │
│   - contains / declares / calls / routes-to / delegates-to                 │
│   - uses-eai / publishes-event / consumes-event / processed-by             │
│   - belongs-to-domain / belongs-to-channel / has-action                    │
│   - has-module-role / has-process-role                                     │
│   - validated-by-feedback / promoted-from / degraded-to-stale              │
└──────────┬──────────────────────────────────────────────────────────────────┘
           │
           ├──────────────────────────────┬──────────────────────────────┬──────────────────────────────┐
           ▼                              ▼                              ▼                              ▼
┌──────────────────────┐      ┌──────────────────────┐      ┌──────────────────────┐      ┌──────────────────────┐
│ Code Structure       │      │ Front→Back Flow      │      │ Integration / Channel│      │ Process / Batch      │
│ Projection           │      │ Projection           │      │ Projection           │      │ Projection           │
│ - module tree        │      │ - screen/route       │      │ - monimo / partner   │      │ - batch job          │
│ - file/symbol        │      │ - api/gateway        │      │ - callback / bridge  │      │ - step/tasklet       │
│ - controller/service │      │ - controller/service │      │ - auth / callback    │      │ - queue/processor    │
└──────────────────────┘      └──────────────────────┘      └──────────────────────┘      └──────────────────────┘
           │                              │                              │                              │
           └──────────────────────────────┴──────────────────────────────┴──────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXPLANATION / ANSWER LAYER                        │
│                                                                             │
│  anchor node + path + evidence bundle + caveats + confidence               │
└──────────┬──────────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EVALUATION / FEEDBACK / REPLAY                       │
│                                                                             │
│  ask/search result -> evaluation artifact -> replay queue -> feedback      │
│  -> candidate / validated / stale lifecycle update                         │
└──────────┬──────────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         VISUALIZATION / OPERATOR UI                         │
│                                                                             │
│  1. Project Overview Graph                                                  │
│  2. Front→Back Path Viewer                                                  │
│  3. Module Role Graph                                                       │
│  4. Integration Graph                                                       │
│  5. Process / Batch Graph                                                   │
│  6. Knowledge Lifecycle Dashboard                                           │
│  7. Question Trace Viewer                                                   │
└─────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                        WHAT GETS REUSED FROM TODAY                          │
└─────────────────────────────────────────────────────────────────────────────┘

   ┌──────────────────────┐
   │ structure index      │
   └──────────┬───────────┘
              │
   ┌──────────────────────┐
   │ front-back graph     │
   └──────────┬───────────┘
              │
   ┌──────────────────────┐
   │ EAI dictionary       │
   └──────────┬───────────┘
              │
   ┌──────────────────────┐
   │ learned knowledge    │
   └──────────┬───────────┘
              │
   ┌──────────────────────┐
   │ retrieval units      │
   └──────────┬───────────┘
              │
   ┌──────────────────────┐
   │ replay / trends /    │
   │ feedback / promotion │
   └──────────┬───────────┘
              │
              ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │      Reinterpreted as ontology nodes / edges / projections           │
   └───────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                          DOMAIN PACKS IN NEW WORLD                          │
└─────────────────────────────────────────────────────────────────────────────┘

   Old role:
     domain pack = 중심 분류 / 핵심 retrieval driver

   New role:
     domain pack = 보조 semantic view / alias bundle / weak prior / UI filter

   Meaning:
     domain pack is NOT the core knowledge system anymore.
     ontology graph becomes the core knowledge system.

