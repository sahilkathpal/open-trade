import { initializeApp, getApps, FirebaseApp } from "firebase/app"
import { getAuth, Auth } from "firebase/auth"
import { getAnalytics, isSupported } from "firebase/analytics"

const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY

let auth: Auth | null = null

if (apiKey) {
  const app: FirebaseApp = getApps().length
    ? getApps()[0]
    : initializeApp({
        apiKey,
        authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
        measurementId:     process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
      })
  auth = getAuth(app)
  isSupported().then(yes => { if (yes) getAnalytics(app) })
}

export { auth }
