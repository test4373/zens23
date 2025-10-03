#!/bin/bash

# 🚀 Deploy to Netlify - FREE CDN
# 100 GB bandwidth/month + Unlimited requests

echo "🚀 =================================="
echo "   NETLIFY DEPLOYMENT (FREE)"
echo "===================================="
echo ""

# Check if netlify CLI is installed
if ! command -v netlify &> /dev/null; then
    echo "📦 Installing Netlify CLI..."
    npm install -g netlify-cli
else
    echo "✅ Netlify CLI already installed"
fi

echo ""
echo "📝 This will deploy your CDN to Netlify"
echo "   ✅ 100 GB bandwidth/month"
echo "   ✅ Unlimited edge requests"
echo "   ✅ No daily limits"
echo "   ✅ Global CDN"
echo ""

read -p "Continue? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deployment cancelled"
    exit 1
fi

echo ""
echo "🔑 Login to Netlify..."
netlify login

echo ""
echo "🚀 Deploying to production..."
netlify deploy --prod --dir=. --functions=netlify-functions

echo ""
echo "✅ =================================="
echo "   DEPLOYMENT COMPLETE!"
echo "===================================="
echo ""
echo "📋 Your CDN URL:"
netlify status | grep "URL" | head -1
echo ""
echo "📝 Usage example:"
echo "   https://your-site.netlify.app/api/cdn?url=http://localhost:64621/streamfile/..."
echo ""
echo "🔧 Next steps:"
echo "   1. Copy your site URL"
echo "   2. Update cdn-config.js:"
echo "      netlify.edgeUrl = 'https://your-site.netlify.app/api'"
echo "   3. Restart your server"
echo ""
echo "🎉 Done! Your FREE CDN is live!"
echo ""
