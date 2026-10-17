# YouTube Music discovery investigation — 2026-10-16

The [initial report](report.html) covers fifteen artists with linked YouTube channels and no
discovered videos. The [official-category report](official-report.html) records the deeper shelf,
playlist and sampled-video investigation used to design official-video admission. Public metadata
was inspected without changing catalog decisions. Raw exploratory captures stay local.

The accepted behavior is documented in [product vision](../../docs/product-vision.md) and
[process flows](../../docs/process-flows.md). Official authority evidence still requires artist/song
identity, content exclusions and a bounded discovery motion sample. Configurable full-file checks
are a separate acquisition/import policy.

Deployment helpers preserve every existing mount and retain the previous Vidarr container. Run
`deploy.ps1` with an explicit `releaseImage` and unique `deploymentId` after tests/build succeed.
It stops only Vidarr, makes a bounded offline database/WAL backup into a private Docker volume,
checks the recovered backup and recreates only the Vidarr service. Credentials never enter this
repository. Check health and run `verify-preservation.py` read-only against the corresponding
backup volume after deployment. No media/staging bytes are copied, deleted or reset.

`run-server-tests.sh` is for a disposable Node 22 base/test image only. It copies schema/migrations
to a private `/dev/shm` directory, links the test schema there and runs the unchanged complete
server suite with 30-second test/hook deadlines. Mount this directory read-only at `/audit`, use
`--network none --shm-size 256m`, and invoke `/bin/sh /audit/run-server-tests.sh`. This avoids SQLite
fsync contention with production during host-based release checks; it never mounts production data.
