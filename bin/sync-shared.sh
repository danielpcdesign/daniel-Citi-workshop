#!/usr/bin/env bash
# Vendor backend/_shared into every Python Lambda as backend/<dir>/shared (AD-02).
# Physical copies are the only thing both the cloud zip and LocalStack's hot-reload mount can see.
# The copies are gitignored; edit backend/_shared, never a vendored copy.
# Usage: ./bin/sync-shared.sh   (called by start-dev.sh and deploy-backend.sh)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../backend" && pwd -P)"
SHARED_DIR="$BACKEND_DIR/_shared"

# every discovered python service, plus _migrate (excluded from discovery but still a lambda)
targets=()
for req in "$BACKEND_DIR"/*/requirements.txt; do
    name="$(basename "$(dirname "$req")")"
    [[ "$name" == _* ]] && continue
    targets+=("$name")
done
[ -f "$BACKEND_DIR/_migrate/requirements.txt" ] && targets+=("_migrate")

missing=0
for name in "${targets[@]}"; do
    dir="$BACKEND_DIR/$name"

    # shared code's deps must be installed per service (pip_requirements = true reads each service's own file)
    while IFS= read -r dep; do
        [[ -z "$dep" || "$dep" == \#* ]] && continue
        if ! grep -qxF "$dep" "$dir/requirements.txt"; then
            echo "  ✗ $name/requirements.txt is missing '$dep' (required by backend/_shared)"
            missing=1
        fi
    done < "$SHARED_DIR/requirements.txt"

    rm -rf "$dir/shared"
    mkdir -p "$dir/shared"
    # copy sources only; no __pycache__ or the requirements list
    find "$SHARED_DIR" -maxdepth 1 -name '*.py' -exec cp {} "$dir/shared/" \;
    echo "  ✓ synced shared -> $name"
done

if [ "$missing" -ne 0 ]; then
    echo "  ✗ fix the requirements above; a missing dependency only fails at runtime otherwise"
    exit 1
fi
