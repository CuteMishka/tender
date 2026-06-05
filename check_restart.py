import paramiko
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    ssh.connect('85.116.182.35', username='cloud-user', password='ChangeMeN0W!', timeout=10)
    _,out,err = ssh.exec_command('sudo docker ps -a')
    print('OUT:', out.read().decode('utf-8', errors='replace').encode('ascii', errors='replace').decode())
    print('ERR:', err.read().decode('utf-8', errors='replace').encode('ascii', errors='replace').decode())
except Exception as e:
    print(f"Connection failed: {e}")
