from pathlib import Path

import coverage

# relative to where the tests run, the same way .coveragerc's `source = backend` is
BACKEND = Path("backend")


# coverage.py configurer plugin: omit what bin/pip-ignore.sh recorded as pip-installed in each service
# dir, so a single-module dependency (typing_extensions.py) never counts as our code (AD-02)
class PipInstalledOmit(coverage.CoveragePlugin):
    def configure(self, config):
        omit = list(config.get_option("run:omit") or [])
        for listing in BACKEND.glob("*/.gitignore"):
            svc_dir = listing.parent
            for line in listing.read_text().splitlines():
                if line.startswith("/"):
                    installed = svc_dir / line[1:]
                    omit += [str(installed), f"{installed}/*"]
        config.set_option("run:omit", omit)


def coverage_init(reg, options):
    reg.add_configurer(PipInstalledOmit())
