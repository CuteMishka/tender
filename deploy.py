import paramiko
import sys

host = '85.116.182.35'
user = 'cloud-user'
password = 'ChangeMeN0W!'
port = 22

def create_ssh_client(server, port, user, password):
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(server, port, user, password)
    return client

print(f"Connecting to {host}...")
try:
    ssh = create_ssh_client(host, port, user, password)
except Exception as e:
    print(f"Failed to connect: {e}")
    sys.exit(1)

print("Connected. Uploading project.tar.gz using SFTP...")
try:
    sftp = ssh.open_sftp()
    sftp.put('project.tar.gz', 'project.tar.gz')
    sftp.close()
    print("Upload complete.")
except Exception as e:
    print(f"Upload failed: {e}")
    sys.exit(1)

commands = [
    "mkdir -p tender1",
    "tar -xzf project.tar.gz -C tender1",
    "cd tender1 && docker-compose -f docker-compose.prod.yml down",
    "cd tender1 && docker-compose -f docker-compose.prod.yml build",
    "cd tender1 && docker-compose -f docker-compose.prod.yml up -d",
    "cd tender1 && docker-compose -f docker-compose.prod.yml ps"
]

print("Executing deployment commands on the server...")
for command in commands:
    print(f"Executing: {command}")
    stdin, stdout, stderr = ssh.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8').strip()
    err = stderr.read().decode('utf-8').strip()
    if out:
        print(f"STDOUT:\n{out}")
    if err:
        print(f"STDERR:\n{err}")
    if exit_status != 0:
        print(f"Command failed with exit status {exit_status}")
        sys.exit(1)

print("Deployment finished successfully!")
ssh.close()
