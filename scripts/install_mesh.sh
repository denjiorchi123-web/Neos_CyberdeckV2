#!/bin/bash
# install_mesh.sh
# This script installs the CyberDeck Mesh Daemon as a system-level systemd service.

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (sudo ./install_mesh.sh)"
  exit 1
fi

echo "[*] Copying python script to /opt/cyberdeck/scripts..."
mkdir -p /opt/cyberdeck/scripts
cp mesh_node.py /opt/cyberdeck/scripts/
chmod +x /opt/cyberdeck/scripts/mesh_node.py

echo "[*] Installing systemd service..."
cp mesh.service /etc/systemd/system/

echo "[*] Reloading systemd daemon..."
systemctl daemon-reload

echo "[*] Enabling mesh service to start on boot..."
systemctl enable mesh.service

echo "[*] Starting mesh service now..."
systemctl start mesh.service

echo "[*] Installation complete! The mesh is now running at the system level."
echo "Check status with: sudo systemctl status mesh"
