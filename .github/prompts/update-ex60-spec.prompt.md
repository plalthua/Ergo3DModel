---
description: "Research and update EX60 geometry in the spec with cited sources"
agent: Master Agent
argument-hint: "topic, e.g. 'seat travel', 'steering column', 'mirror glass size'"
---
Topic: ${input:topic:what to research}

Search Volvo Cars official sources first, then press and homologation sources, then SPA2/SPA3 proxies.
Update [ex60_spec.json](../../data/ex60_spec.json) only where your source beats the current confidence.
Return a table with the path, old value, new value, confidence and source, plus any remaining gaps.
