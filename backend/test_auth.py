#!/usr/bin/env python3
"""
AI Agent 认证系统测试脚本
"""
import json
import os
import time

import requests

BASE_URL = "http://localhost:4096"
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")


def test_admin_login():
    """测试管理员登录"""
    print("\n=== 测试管理员登录 ===")
    response = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}
    )
    print(f"状态码: {response.status_code}")
    if response.ok:
        data = response.json()
        print(f"✅ 登录成功")
        print(f"Access Token: {data['access_token'][:50]}...")
        return data
    else:
        print(f"❌ 登录失败: {response.text}")
        return None


def test_create_api_key(admin_token):
    """测试创建 API Key"""
    print("\n=== 测试创建 API Key ===")
    response = requests.post(
        f"{BASE_URL}/api/admin/api-keys",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "name": "测试 API Key",
            "description": "用于测试的 API Key",
            "expires_days": 30,
            "rate_limit": 100
        }
    )
    print(f"状态码: {response.status_code}")
    if response.ok:
        data = response.json()
        print(f"✅ API Key 创建成功")
        print(f"API Key: {data['key']}")
        print(f"名称: {data['name']}")
        print(f"有效期: {data['expires_at']}")
        return data['key']
    else:
        print(f"❌ 创建失败: {response.text}")
        return None


def test_exchange_token(api_key):
    """测试使用 API Key 换取 Token"""
    print("\n=== 测试 API Key 换取 Token ===")
    response = requests.post(
        f"{BASE_URL}/api/auth/token",
        json={"api_key": api_key}
    )
    print(f"状态码: {response.status_code}")
    if response.ok:
        data = response.json()
        print(f"✅ Token 获取成功")
        print(f"Access Token: {data['access_token'][:50]}...")
        print(f"过期时间: {data['expires_in']} 秒")
        return data
    else:
        print(f"❌ 获取失败: {response.text}")
        return None


def test_chat(access_token):
    """测试聊天接口"""
    print("\n=== 测试聊天接口 ===")
    response = requests.post(
        f"{BASE_URL}/api/chat",
        headers={"Authorization": f"Bearer {access_token}"},
        json={
            "message": "你好，这是一个测试消息",
            "context": {"pathname": "/"}
        }
    )
    print(f"状态码: {response.status_code}")
    if response.ok:
        data = response.json()
        print(f"✅ 聊天成功")
        print(f"响应: {json.dumps(data, ensure_ascii=False, indent=2)}")
        return True
    else:
        print(f"❌ 聊天失败: {response.text}")
        return False


def test_refresh_token(refresh_token):
    """测试刷新 Token"""
    print("\n=== 测试刷新 Token ===")
    response = requests.post(
        f"{BASE_URL}/api/auth/refresh",
        json={"refresh_token": refresh_token}
    )
    print(f"状态码: {response.status_code}")
    if response.ok:
        data = response.json()
        print(f"✅ Token 刷新成功")
        print(f"新 Access Token: {data['access_token'][:50]}...")
        return data['access_token']
    else:
        print(f"❌ 刷新失败: {response.text}")
        return None


def test_list_api_keys(admin_token):
    """测试列出 API Keys"""
    print("\n=== 测试列出 API Keys ===")
    response = requests.get(
        f"{BASE_URL}/api/admin/api-keys",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    print(f"状态码: {response.status_code}")
    if response.ok:
        data = response.json()
        print(f"✅ 获取成功")
        print(f"API Key 数量: {len(data['keys'])}")
        for key in data['keys']:
            print(f"  - {key['name']}: {key['key']} (使用次数: {key['total_requests']})")
        return True
    else:
        print(f"❌ 获取失败: {response.text}")
        return False


def test_stats(admin_token):
    """测试统计接口"""
    print("\n=== 测试统计接口 ===")
    response = requests.get(
        f"{BASE_URL}/api/admin/stats",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    print(f"状态码: {response.status_code}")
    if response.ok:
        data = response.json()
        print(f"✅ 获取成功")
        print(f"统计数据: {json.dumps(data, ensure_ascii=False, indent=2)}")
        return True
    else:
        print(f"❌ 获取失败: {response.text}")
        return False


def test_rate_limit(access_token):
    """测试速率限制"""
    print("\n=== 测试速率限制 ===")
    print("发送 10 个快速请求...")

    success_count = 0
    rate_limited = False

    for i in range(10):
        response = requests.post(
            f"{BASE_URL}/api/chat",
            headers={"Authorization": f"Bearer {access_token}"},
            json={
                "message": f"测试消息 {i + 1}",
                "context": {"pathname": "/"}
            }
        )

        if response.ok:
            success_count += 1
            print(f"  请求 {i + 1}: ✅ 成功")
        elif response.status_code == 429:
            rate_limited = True
            print(f"  请求 {i + 1}: ⚠️ 速率限制")
            break
        else:
            print(f"  请求 {i + 1}: ❌ 失败 ({response.status_code})")

        time.sleep(0.1)

    print(f"\n成功请求: {success_count}/10")
    if rate_limited:
        print("✅ 速率限制正常工作")
    else:
        print("ℹ️ 未触发速率限制（可能需要更多请求）")


def main():
    """运行所有测试"""
    print("=" * 60)
    print("AI Agent 认证系统测试")
    print("=" * 60)

    if not ADMIN_PASSWORD:
        print("\n❌ 请先设置环境变量 ADMIN_PASSWORD，再运行测试")
        return

    # 1. 管理员登录
    admin_auth = test_admin_login()
    if not admin_auth:
        print("\n❌ 管理员登录失败，无法继续测试")
        return

    admin_token = admin_auth['access_token']

    # 2. 创建 API Key
    api_key = test_create_api_key(admin_token)
    if not api_key:
        print("\n❌ API Key 创建失败，无法继续测试")
        return

    # 3. 使用 API Key 换取 Token
    token_data = test_exchange_token(api_key)
    if not token_data:
        print("\n❌ Token 获取失败，无法继续测试")
        return

    access_token = token_data['access_token']
    refresh_token = token_data['refresh_token']

    # 4. 测试聊天接口
    test_chat(access_token)

    # 5. 测试刷新 Token
    new_access_token = test_refresh_token(refresh_token)

    # 6. 使用新 Token 测试聊天
    if new_access_token:
        test_chat(new_access_token)

    # 7. 列出 API Keys
    test_list_api_keys(admin_token)

    # 8. 获取统计数据
    test_stats(admin_token)

    # 9. 测试速率限制
    test_rate_limit(access_token)

    print("\n" + "=" * 60)
    print("测试完成！")
    print("=" * 60)
    print("\n访问管理后台：")
    print(f"  - API Key 管理: {BASE_URL}/admin/auth")
    print(f"  - 模型配置: {BASE_URL}/admin")


if __name__ == "__main__":
    try:
        main()
    except requests.exceptions.ConnectionError:
        print("\n❌ 无法连接到服务器，请确保服务已启动：")
        print("   cd backend && python main.py")
    except KeyboardInterrupt:
        print("\n\n测试已中断")
