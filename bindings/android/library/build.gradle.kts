plugins {
    id("com.android.library")
    id("maven-publish")
}

val sdkVersion = providers.gradleProperty("sdkVersion").orElse("0.1.0")

android {
    namespace = "com.wangyihao0001.makeupsdk"
    compileSdk = 35

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
        externalNativeBuild {
            cmake {
                cppFlags += listOf("-std=c++17", "-Wall", "-Wextra", "-Wpedantic")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    ndkVersion = "27.2.12479018"

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.28.3"
        }
    }

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        buildConfigField("String", "SDK_VERSION", "\"${sdkVersion.get()}\"")
    }

    publishing {
        singleVariant("release") {
            withSourcesJar()
        }
    }
}

dependencies {
}

afterEvaluate {
    publishing {
        publications {
            create<MavenPublication>("release") {
                from(components["release"])
                groupId = "com.wangyihao0001"
                artifactId = "makeup-sdk-android"
                version = sdkVersion.get()
            }
        }
    }
}
