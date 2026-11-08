#!/usr/bin/env bash
set -euo pipefail

# Azure mirror downloads can exhaust a job's budget before tests start.
# Keep the runner's source priorities and use the main Ubuntu archive.
sudo sed -i 's|azure.archive.ubuntu.com|archive.ubuntu.com|g' /etc/apt/apt-mirrors.txt
