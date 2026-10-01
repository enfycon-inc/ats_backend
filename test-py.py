import urllib.request
try:
    with urllib.request.urlopen('http://localhost:5000/api/market-segments') as response:
        html = response.read()
        print(response.status)
        print(html.decode('utf-8'))
except Exception as e:
    print(e)
