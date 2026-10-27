---
description: "Import a real EX60 test-vehicle log and replay it on the 3D ergo model"
agent: Master Agent
argument-hint: "log file paths (CSV/MF4), driver percentile, optional clock offsets"
---
Import these test logs: ${input:logs:paths to CSV or MF4 files}

Driver manikin: ${input:manikin:profile ID from data/ex60_spec.json manikins}

1. List the signals in each file and propose a mapping to the canonical channels in
   [signal_mapping.json](../../config/signal_mapping.json). Show the scale, offset and sign convention for each.
   Ask me before you write the mapping.
2. Determine the clock offsets between files and an align event, if one is useful.
3. Run the sync and the report, then tell me how to open the timeline in the viewer.
4. Summarise the missing channels, the out-of-range adjustments and the flagged ergo frames with timestamps.
