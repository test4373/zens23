#!/bin/bash

# 🚀 Deploy to Vercel - FREE CDN
# 100 GB bandwidth/month + Unlimited requests

echo "🚀 =================================="
echo "   VERCEL DEPLOYMENT (FREE)"
echo "===================================="
echo ""

# Check if vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "📦 Installing Vercel CLI..."
    npm install -g vercel
else
    echo "✅ Vercel CLI already installed"
fi

echo ""
echo "📝 This will deploy your CDN to Vercel"
echo "   ✅ 100 GB bandwidth/month"
echo "   ✅ Unlimited requests"
echo "   ✅ No daily limits"
echo "   ✅ Global edge network"
echo ""

read -p "Continue? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deployment cancelled"
    exit 1
fi

echo ""
echo "🔑 Login to Vercel..."
vercel login

echo ""
echo "🚀 Deploying to production..."
vercel --prod

echo ""
echo "✅ =================================="
echo "   DEPLOYMENT COMPLETE!"
echo "===================================="
echo ""
echo "📋 Your CDN URL:"
vercel ls | grep "https://" | head -1
echo ""
echo "📝 Usage example:"
echo "   https://your-app.vercel.app/api/cdn?url=http://localhost:64621/streamfile/..."
echo ""
echo "🔧 Next steps:"
echo "   1. Copy your deployment URL"
echo "   2. Update cdn-config.js:"
echo "      vercel.edgeUrl = 'https://your-app.vercel.app/api'"
echo "   3. Restart your server"
echo ""
echo "🎉 Done! Your FREE CDN is live!"
echo ""
