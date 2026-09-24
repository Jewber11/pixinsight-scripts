# Personal PixInsight scripts

`build-pixinsight-repository.sh` packages every `.js` file below this directory.
Directory layout stays intact inside `src/scripts`.

Build after adding or changing scripts:

```bash
./build-pixinsight-repository.sh
```

Commit and push `pixinsight-repository/` to a public GitHub repository. Add this URL
to PixInsight:

```text
https://raw.githubusercontent.com/Jewber11/pixinsight-scripts/main/pixinsight-repository/
```

PixInsight needs an HTTP/HTTPS repository URL. It cannot update directly from this
local filesystem directory.

Keep the trailing `/`. In PixInsight use:

1. `Resources > Updates > Manage Repositories > Add`
2. Add the URL.
3. `Resources > Updates > Check for Updates`.
4. Apply changes and restart PixInsight.

Every script needs a `#feature-id` directive to appear in the Script menu.
This script appears under `Sam's Scripts > Automatic Subframe Cull`.

## Adaptive Faint Emission

Activate an RGB image and run `Script > Sam's Scripts > Adaptive Faint Emission`.
The script analyzes the image, builds a faint-emission mask, and enhances it in one run.
See [usage and limits](adaptive_faint_emission/README.md).
