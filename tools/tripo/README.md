# Tripo pipeline

How the 3D models in `public/models/` are made. Every request is logged in
`tasks.jsonl` (endpoint, full request body, task id), so any asset can be traced back
to the prompt that produced it and regenerated.

## Access

- API: `https://openapi.tripo3d.ai/v3` (international accounts; `openapi.tripo3d.com`
  is the China region and rejects these keys).
- In the cloud environment `isometry-rpg` the network proxy adds the API key to every
  request, so scripts send no key themselves. Elsewhere, `export TRIPO_API_KEY=...`.
- Downloads come from `openapi-dl.data.tripo3d.com` (allowed in the environment).
- Limits: image generation runs one task at a time, 3D generation five. `tripo.sh`
  waits and retries when a pool is full.

## Steps

1. **Style anchor.** One concept image of the hero (`generation/text-to-image`,
   `template: t_pose`). Every other concept is made with `generation/image-to-image`
   from this image, so all assets share palette and rendering.
2. **Concept → 3D.** `generation/image-to-model`, model `P2-20260801` (clean game
   topology), PBR textures. Face budgets: hero 20k, wolf 15k, tree 10k, weapons 3k.
3. **Skeleton.** `animations/rig`:
   - humanoids: `rig_type: biped`, model `v3.0-20260909`, `spec: mixamo` — Mixamo bone
     names, so Mixamo's animation library also fits;
   - animals: `rig_type: quadruped`, model `v2.5-20260210` (also hexapod, octopod,
     avian, serpentine, aquatic).
4. **Animations.** `animations/retarget` with presets, `animate_in_place: true`.
   Humanoid: `preset:idle`, `walk`, `run`, `slash`, `hurt` (up to 5 per request).
   Quadruped: only `preset:quadruped:walk` exists; everything else is procedural in code.
5. **Web optimisation.** `node tools/models/optimize.mjs in.glb out.glb --texture 1024`:
   WebP textures, meshopt-compressed geometry and animation. 21 MB → 2.3 MB for the
   first set.

## Example

```bash
tools/tripo/tripo.sh balance
tools/tripo/tripo.sh run generation/image-to-model \
  '{"input":"<concept task id>","model":"P2-20260801","face_limit":3000,"texture":true,"pbr":true}'
```

## Cost of the first set (credits)

| Asset | Concept | Model | Rig | Animations | Total |
|---|---|---|---|---|---|
| Hero (5 animations) | 10 | 110 | 25 | 50 | 195 |
| Wolf (walk) | 10 | 110 | 25 | 10 | 155 |
| Weapon (each) | 10 | 110 | — | — | 120 |
| Prop (each) | 10 | 110 | — | — | 120 |
| Boar (walk) | 10 | 110 | 25 | 10 | 155 |
| Mine ghoul (6 animations) | 10 | 110 | 25 | 60 | 205 |
| Hero: death and shot clips | — | — | — | 20 | 20 |
| Hero, ragged and leather looks (each) | 10 | 110 | 25 | 50 | 195 |

All 18 models so far: 2 320 credits. Clips do not carry over between separately
rigged models (their rest poses differ), so each look gets its own animations.
