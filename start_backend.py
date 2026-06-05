import paramiko
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    ssh.connect('85.116.182.35', username='cloud-user', password='ChangeMeN0W!', timeout=5)
    _,out,err = ssh.exec_command('sudo docker-compose -f docker-compose.prod.yml --env-file .env up -d backend && sudo docker ps -a | grep backend')
    print('OUT:', out.read().decode('utf-8', errors='replace').encode('ascii', errors='replace').decode())
    print('ERR:', err.read().decode('utf-8', errors='replace').encode('ascii', errors='replace').decode())
except Exception as e:
    print(f"Error: {e}")
